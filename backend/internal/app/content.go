package app

import (
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type Party struct {
	Title    string  `json:"title"`
	Timezone string  `json:"timezone"`
	Date     *string `json:"date"`
	Location string  `json:"location"`
}

type Event struct {
	ID          int64   `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Teaser      string  `json:"teaser"`
	StartsAt    *string `json:"startsAt"`
	UnlockAt    *string `json:"unlockAt"`
	Locked      bool    `json:"locked"`
}

type eventInput struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Teaser      string  `json:"teaser"`
	StartsAt    *string `json:"startsAt"`
	UnlockAt    *string `json:"unlockAt"`
}

type Entry struct {
	ID        int64  `json:"id"`
	Author    Author `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

func (a *App) getParty(w http.ResponseWriter, r *http.Request, _ Guest) {
	var party Party
	err := a.db.QueryRowContext(r.Context(), "SELECT title,timezone,date,location FROM party WHERE id=1").Scan(&party.Title, &party.Timezone, &party.Date, &party.Location)
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, party)
}

func normalizeTime(value **string) bool {
	if *value == nil {
		return true
	}
	parsed, err := time.Parse(time.RFC3339, **value)
	if err != nil || parsed.Year() < 2000 || parsed.Year() > 2200 {
		return false
	}
	normalized := stamp(parsed)
	*value = &normalized
	return true
}

func (a *App) updateParty(w http.ResponseWriter, r *http.Request, guest Guest) {
	var input Party
	if !decode(w, r, &input) {
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Location = strings.TrimSpace(input.Location)
	if utf8.RuneCountInString(input.Title) > 120 || utf8.RuneCountInString(input.Location) > 240 {
		fail(w, 400, "invalid_party")
		return
	}
	if input.Timezone == "" || input.Timezone == "Local" || len(input.Timezone) > 80 {
		fail(w, 400, "invalid_timezone")
		return
	}
	if _, err := time.LoadLocation(input.Timezone); err != nil {
		fail(w, 400, "unknown_timezone")
		return
	}
	if !normalizeTime(&input.Date) {
		fail(w, 400, "invalid_date")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), "UPDATE party SET title=?,timezone=?,date=?,location=? WHERE id=1", input.Title, input.Timezone, input.Date, input.Location); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, input)
}

func eventView(event Event, now time.Time, private bool) Event {
	if event.UnlockAt != nil {
		unlock, err := time.Parse(time.RFC3339Nano, *event.UnlockAt)
		// Invalid stored times fail closed rather than exposing a surprise.
		event.Locked = err != nil || now.Before(unlock)
	}
	if event.Locked && !private {
		event.Title = event.Teaser
		event.Description = ""
	}
	return event
}

func (a *App) listProgramme(w http.ResponseWriter, r *http.Request, _ Guest) { a.events(w, r, false) }
func (a *App) listAdminProgramme(w http.ResponseWriter, r *http.Request, _ Guest) {
	a.events(w, r, true)
}

func (a *App) events(w http.ResponseWriter, r *http.Request, private bool) {
	rows, err := a.db.QueryContext(r.Context(), "SELECT id,title,description,teaser,starts_at,unlock_at FROM events LIMIT 200")
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []Event{}
	now := a.now()
	for rows.Next() {
		var event Event
		if err := rows.Scan(&event.ID, &event.Title, &event.Description, &event.Teaser, &event.StartsAt, &event.UnlockAt); err != nil {
			internal(w, err)
			return
		}
		items = append(items, eventView(event, now, private))
	}
	if err := rows.Err(); err != nil {
		internal(w, err)
		return
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].StartsAt == nil {
			return false
		}
		if items[j].StartsAt == nil {
			return true
		}
		left, _ := time.Parse(time.RFC3339Nano, *items[i].StartsAt)
		right, _ := time.Parse(time.RFC3339Nano, *items[j].StartsAt)
		if left.Equal(right) {
			return items[i].ID < items[j].ID
		}
		return left.Before(right)
	})
	respond(w, 200, map[string]any{"items": items})
}

func parseEvent(w http.ResponseWriter, r *http.Request) (eventInput, bool) {
	var input eventInput
	if !decode(w, r, &input) {
		return input, false
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.Teaser = strings.TrimSpace(input.Teaser)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 160 || utf8.RuneCountInString(input.Description) > 4000 || utf8.RuneCountInString(input.Teaser) > 160 {
		fail(w, 400, "invalid_event")
		return input, false
	}
	if !normalizeTime(&input.StartsAt) || !normalizeTime(&input.UnlockAt) {
		fail(w, 400, "invalid_date")
		return input, false
	}
	return input, true
}

func (a *App) createEvent(w http.ResponseWriter, r *http.Request, _ Guest) {
	input, ok := parseEvent(w, r)
	if !ok {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM events").Scan(&count); err != nil {
		internal(w, err)
		return
	}
	if count >= 200 {
		fail(w, 409, "event_limit_reached")
		return
	}
	result, err := tx.ExecContext(r.Context(), "INSERT INTO events(title,description,teaser,starts_at,unlock_at) VALUES(?,?,?,?,?)", input.Title, input.Description, input.Teaser, input.StartsAt, input.UnlockAt)
	if err != nil {
		internal(w, err)
		return
	}
	id, err := result.LastInsertId()
	if err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 201, eventView(Event{ID: id, Title: input.Title, Description: input.Description, Teaser: input.Teaser, StartsAt: input.StartsAt, UnlockAt: input.UnlockAt}, a.now(), true))
}

func (a *App) updateEvent(w http.ResponseWriter, r *http.Request, _ Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	input, ok := parseEvent(w, r)
	if !ok {
		return
	}
	result, err := a.db.ExecContext(r.Context(), "UPDATE events SET title=?,description=?,teaser=?,starts_at=?,unlock_at=? WHERE id=?", input.Title, input.Description, input.Teaser, input.StartsAt, input.UnlockAt, id)
	if !affected(w, result, err) {
		return
	}
	respond(w, 200, eventView(Event{ID: id, Title: input.Title, Description: input.Description, Teaser: input.Teaser, StartsAt: input.StartsAt, UnlockAt: input.UnlockAt}, a.now(), true))
}

func (a *App) deleteEvent(w http.ResponseWriter, r *http.Request, _ Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM events WHERE id=?", id)
	if affected(w, result, err) {
		w.WriteHeader(204)
	}
}

func (a *App) listEntries(w http.ResponseWriter, r *http.Request, _ Guest) {
	before, limit, ok := page(w, r)
	if !ok {
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT e.id,g.id,g.name,e.body,e.created_at FROM entries e JOIN guests g ON e.guest_id=g.id WHERE (?=0 OR e.id<?) ORDER BY e.id DESC LIMIT ?`, before, before, limit+1)
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		var entry Entry
		if err := rows.Scan(&entry.ID, &entry.Author.ID, &entry.Author.Name, &entry.Body, &entry.CreatedAt); err != nil {
			internal(w, err)
			return
		}
		items = append(items, entry)
	}
	if err := rows.Err(); err != nil {
		internal(w, err)
		return
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		next = cursor(items[len(items)-1].ID)
	}
	respond(w, 200, map[string]any{"items": items, "nextCursor": next})
}

func (a *App) createEntry(w http.ResponseWriter, r *http.Request, guest Guest) {
	var input struct {
		Body string `json:"body"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Body = strings.TrimSpace(input.Body)
	if length := utf8.RuneCountInString(input.Body); length < 1 || length > 2000 {
		fail(w, 400, "invalid_message")
		return
	}
	entry := Entry{Author: Author{ID: guest.ID, Name: guest.Name}, Body: input.Body, CreatedAt: stamp(a.now())}
	result, err := a.db.ExecContext(r.Context(), "INSERT INTO entries(guest_id,body,created_at) VALUES(?,?,?)", guest.ID, entry.Body, entry.CreatedAt)
	if err != nil {
		internal(w, err)
		return
	}
	entry.ID, err = result.LastInsertId()
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 201, entry)
}

func (a *App) deleteEntry(w http.ResponseWriter, r *http.Request, guest Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var author int64
	err := a.db.QueryRowContext(r.Context(), "SELECT guest_id FROM entries WHERE id=?", id).Scan(&author)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "message_not_found")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	if guest.Role != "admin" && guest.ID != author {
		fail(w, 403, "message_delete_forbidden")
		return
	}
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM entries WHERE id=?", id)
	if affected(w, result, err) {
		w.WriteHeader(204)
	}
}
