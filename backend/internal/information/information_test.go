package information

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestNormalizeTrimsAndBoundsTabs(t *testing.T) {
	input := Page{Enabled: true, Revision: 9, Tabs: []Tab{{Title: "  Useful  ", Body: "  Taxi: +41 79 000 00 00\n\nSecond paragraph.  "}}}
	page, err := Normalize(input)
	if err != nil {
		t.Fatal(err)
	}
	want := Page{Enabled: true, Tabs: []Tab{{Title: "Useful", Body: "Taxi: +41 79 000 00 00\n\nSecond paragraph."}}}
	if !reflect.DeepEqual(page, want) {
		t.Fatalf("normalized page=%+v", page)
	}
	page.Tabs[0].Title = "Changed"
	if input.Tabs[0].Title != "  Useful  " {
		t.Fatal("normalization shares the caller's tabs")
	}
	if empty, err := Normalize(Page{Tabs: []Tab{}}); err != nil || empty.Tabs == nil || len(empty.Tabs) != 0 {
		t.Fatalf("an empty page is valid: %+v %v", empty, err)
	}

	tab := Tab{Title: "Title", Body: "Text"}
	for name, tabs := range map[string][]Tab{
		"missing list": nil,
		"blank title":  {{Title: "  ", Body: "Text"}},
		"blank text":   {{Title: "Title", Body: " \n "}},
		"long title":   {{Title: strings.Repeat("é", 41), Body: "Text"}},
		"long text":    {{Title: "Title", Body: strings.Repeat("é", 4001)}},
		"too many":     {tab, tab, tab, tab, tab, tab, tab, tab, tab},
	} {
		if _, err := Normalize(Page{Tabs: tabs}); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err=%v", name, err)
		}
	}
	limits := []Tab{{Title: strings.Repeat("é", 40), Body: strings.Repeat("é", 4000)}}
	if _, err := Normalize(Page{Tabs: limits}); err != nil {
		t.Fatalf("limits are inclusive: %v", err)
	}
}

func TestGuestViewHidesAPageThatIsOffOrEmpty(t *testing.T) {
	tabs := []Tab{{Title: "Useful", Body: "Text"}}
	for name, page := range map[string]Page{
		"off":          {Tabs: tabs},
		"on but empty": {Enabled: true, Tabs: []Tab{}},
	} {
		if view := GuestView(page); view.Enabled || view.Tabs == nil || len(view.Tabs) != 0 {
			t.Errorf("%s: view=%+v", name, view)
		}
	}
	if view := GuestView(Page{Enabled: true, Tabs: tabs}); !view.Enabled || !reflect.DeepEqual(view.Tabs, tabs) {
		t.Fatalf("visible page=%+v", view)
	}
}
