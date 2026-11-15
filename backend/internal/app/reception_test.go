package app

import (
	"context"
	"testing"
	"time"
)

func TestReceptionSlotsKeepOneGuestFromHoldingEveryone(t *testing.T) {
	t.Parallel()
	slots := newReceptionSlots()
	var held []func()
	for range guestReceptions {
		release, ok := slots.acquire(t.Context(), 1, 10)
		if !ok {
			t.Fatal("guest could not start an upload")
		}
		held = append(held, release)
	}
	// The same guest's next file waits for one of their own slots.
	waiting, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if _, ok := slots.acquire(waiting, 1, 10); ok {
		t.Fatal("a guest received more files at once than allowed")
	}
	// Another guest goes straight through.
	release, ok := slots.acquire(t.Context(), 2, 5)
	if !ok {
		t.Fatal("another guest waited behind a busy guest")
	}
	if reserved := slots.inFlight(); reserved != 2*10+5 {
		t.Fatalf("reserved %d bytes", reserved)
	}
	release()
	for _, release := range held {
		release()
	}
	if len(slots.total) != 0 || len(slots.guests) != 0 || slots.inFlight() != 0 {
		t.Fatalf("slots leaked: total=%d guests=%d bytes=%d", len(slots.total), len(slots.guests), slots.inFlight())
	}
}

func TestReceptionSlotsBoundTheWholeApp(t *testing.T) {
	t.Parallel()
	slots := newReceptionSlots()
	var held []func()
	for guest := range int64(totalReceptions) {
		release, ok := slots.acquire(t.Context(), guest, 1)
		if !ok {
			t.Fatal("upload refused below the shared limit")
		}
		held = append(held, release)
	}
	waiting, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if _, ok := slots.acquire(waiting, totalReceptions, 1); ok {
		t.Fatal("more files were received at once than the shared limit")
	}
	for _, release := range held {
		release()
	}
	if len(slots.total) != 0 || len(slots.guests) != 0 {
		t.Fatalf("slots leaked: total=%d guests=%d", len(slots.total), len(slots.guests))
	}
}
