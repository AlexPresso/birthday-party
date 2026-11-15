package app

import (
	"context"
	"sync"
)

// Request bodies are received into private files, so a reception slot costs a
// file descriptor and disk bandwidth rather than memory. Each guest holds at
// most guestReceptions of them: a slow phone delays only its own files, while
// everyone else's uploads and profile photos keep going through.
const (
	totalReceptions = 24
	guestReceptions = 2
)

type receptionSlots struct {
	total    chan struct{}
	mu       sync.Mutex
	guests   map[int64]*guestSlots
	reserved int64 // Bytes announced by receptions in progress, protected by mu.
}

type guestSlots struct {
	slots chan struct{}
	users int // Holders and waiters, protected by receptionSlots.mu.
}

func newReceptionSlots() *receptionSlots {
	return &receptionSlots{total: make(chan struct{}, totalReceptions), guests: map[int64]*guestSlots{}}
}

// acquire waits for one of the guest's slots, then for a shared one, and
// reserves size bytes of disk until release. It reports false when ctx ends
// first; otherwise the caller must call release.
func (s *receptionSlots) acquire(ctx context.Context, guestID, size int64) (release func(), ok bool) {
	s.mu.Lock()
	guest := s.guests[guestID]
	if guest == nil {
		guest = &guestSlots{slots: make(chan struct{}, guestReceptions)}
		s.guests[guestID] = guest
	}
	guest.users++
	s.mu.Unlock()
	leave := func() {
		s.mu.Lock()
		guest.users--
		if guest.users == 0 {
			delete(s.guests, guestID)
		}
		s.mu.Unlock()
	}
	select {
	case guest.slots <- struct{}{}:
	case <-ctx.Done():
		leave()
		return nil, false
	}
	select {
	case s.total <- struct{}{}:
	case <-ctx.Done():
		<-guest.slots
		leave()
		return nil, false
	}
	s.mu.Lock()
	s.reserved += size
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		s.reserved -= size
		s.mu.Unlock()
		<-s.total
		<-guest.slots
		leave()
	}, true
}

// inFlight returns the bytes still to arrive, at most, for receptions in
// progress. Files partly written already count twice, on the side of caution.
func (s *receptionSlots) inFlight() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reserved
}
