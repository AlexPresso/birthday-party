// Package information owns the host-written information page and its tabs.
package information

import (
	"context"
	"strings"
	"unicode/utf8"
)

const (
	maxTabs        = 8
	maxTitleLength = 40
	maxBodyLength  = 4000
)

// Tab is one titled text of the page, kept exactly as the host wrote it.
type Tab struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// Page is what the host edits. Enabled is the host's switch, whatever the tabs.
type Page struct {
	Enabled  bool  `json:"enabled"`
	Revision int64 `json:"revision"`
	Tabs     []Tab `json:"tabs"`
}

// View is what participants receive: tabs only while the page is shown.
type View struct {
	Enabled bool  `json:"enabled"`
	Tabs    []Tab `json:"tabs"`
}

// Error identifies a rejected command without transport details.
type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrInvalid  Error = "invalid_information"
	ErrConflict Error = "information_conflict"
)

// Repository saves the page only if the given revision is still the stored
// one, returning ErrConflict otherwise, and reports the new revision.
type Repository interface {
	Get(context.Context) (Page, error)
	Save(context.Context, int64, Page) (Page, error)
}

type Service struct{ repository Repository }

func New(repository Repository) *Service { return &Service{repository: repository} }

func (s *Service) Page(ctx context.Context) (Page, error) { return s.repository.Get(ctx) }

func (s *Service) View(ctx context.Context) (View, error) {
	page, err := s.repository.Get(ctx)
	if err != nil {
		return View{}, err
	}
	return GuestView(page), nil
}

func (s *Service) Update(ctx context.Context, revision int64, input Page) (Page, error) {
	normalized, err := Normalize(input)
	if err != nil {
		return Page{}, err
	}
	return s.repository.Save(ctx, revision, normalized)
}

// GuestView shows the page once the host turned it on and wrote a tab. A page
// that is off, or still empty, gives nothing away.
func GuestView(page Page) View {
	if !page.Enabled || len(page.Tabs) == 0 {
		return View{Tabs: []Tab{}}
	}
	return View{Enabled: true, Tabs: page.Tabs}
}

// Normalize trims the authored texts and returns an independent copy.
func Normalize(input Page) (Page, error) {
	if input.Tabs == nil || len(input.Tabs) > maxTabs {
		return Page{}, ErrInvalid
	}
	tabs := make([]Tab, len(input.Tabs))
	for i, tab := range input.Tabs {
		title, body := strings.TrimSpace(tab.Title), strings.TrimSpace(tab.Body)
		if title == "" || utf8.RuneCountInString(title) > maxTitleLength ||
			body == "" || utf8.RuneCountInString(body) > maxBodyLength {
			return Page{}, ErrInvalid
		}
		tabs[i] = Tab{Title: title, Body: body}
	}
	return Page{Enabled: input.Enabled, Tabs: tabs}, nil
}
