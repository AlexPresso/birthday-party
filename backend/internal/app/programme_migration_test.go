package app

import (
	"testing"
	"time"

	pgprogramme "birthday-party/backend/internal/adapters/postgres/programme"
	"birthday-party/backend/internal/programme"
)

func TestProgrammeMigrationTurnsNestedVotesIntoEventsWithoutLosingContent(t *testing.T) {
	db := testDatabase(t)
	files := migrationFiles(t)
	delete(files, "migrations/0011_programme_activity_events.sql")
	delete(files, "migrations/0012_product_configuration.sql")
	delete(files, "migrations/0013_question_activities.sql")
	if err := applyMigrations(t.Context(), db, files); err != nil {
		t.Fatal(err)
	}
	_, err := db.Exec(`INSERT INTO guests(name,role) VALUES('Host','admin'),('Candidate','guest'),('Voter','guest');
 INSERT INTO events(title,description,teaser,starts_at,unlock_at)
 VALUES('Original title','Original description','Original teaser','2026-10-17T18:00:00Z','2026-10-17T17:00:00Z'),
 ('Dinner','Menu','At the table',NULL,NULL);
 INSERT INTO programme_activities(id,event_id,position,type,revision) VALUES(101,1,0,'vote',4),(102,1,1,'vote',7),(103,1,2,'vote',1);
 INSERT INTO programme_votes(activity_id,question,status,allow_self_vote)
 VALUES(101,'First question','revealed',FALSE),(102,'Second question','open',TRUE),(103,'Draft question','draft',FALSE);
 INSERT INTO programme_vote_candidates(activity_id,guest_id,position)
 VALUES(101,1,0),(101,2,1),(102,2,0),(102,1,1),(103,1,0),(103,2,1);
 INSERT INTO programme_ballots(activity_id,guest_id,candidate_id) VALUES(101,3,2),(102,3,1);`)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(t.Context(), db, migrationFiles(t)); err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(t.Context(), db, migrationFiles(t)); err != nil {
		t.Fatalf("migration rerun: %v", err)
	}
	now := func() time.Time { return time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC) }
	service := programme.New(pgprogramme.New(db, now))
	items, err := service.List(t.Context(), now, 3, true)
	if err != nil || len(items) != 4 {
		t.Fatalf("migrated events=%+v error=%v", items, err)
	}
	byQuestion := map[string]programme.Event{}
	for _, event := range items {
		if event.Type == "event" {
			if event.ID != 2 || event.Title != "Dinner" || event.Description != "Menu" || event.Teaser != "At the table" {
				t.Fatalf("ordinary event changed: %+v", event)
			}
			continue
		}
		if event.Title != "Original title" || event.Description != "Original description" || event.Teaser != "Original teaser" || *event.StartsAt != "2026-10-17T18:00:00Z" || *event.UnlockAt != "2026-10-17T17:00:00Z" {
			t.Fatalf("migrated vote lost authored event content: %+v", event)
		}
		byQuestion[event.Vote.Question] = event
	}
	first, second := byQuestion["First question"], byQuestion["Second question"]
	if first.ID != 1 || first.Revision != 4 || first.Vote.Results[1].Votes != 1 || *first.Vote.MyCandidateID != 2 {
		t.Fatalf("first vote lost identity or ballot: %+v", first)
	}
	if second.ID <= 2 || second.Revision != 7 || second.Vote.Candidates[0].ID != 2 || !second.Vote.AllowSelfVote || second.Vote.Results != nil || *second.Vote.MyCandidateID != 1 {
		t.Fatalf("second vote changed settings or ballot: %+v", second)
	}
	var eventID, position int
	if err := db.QueryRow("SELECT event_id,position FROM programme_activities WHERE id=102").Scan(&eventID, &position); err != nil || int64(eventID) != second.ID || position != 0 {
		t.Fatalf("activity identity or position changed: %d %d %v", eventID, position, err)
	}
	items, err = service.List(t.Context(), now, 3, false)
	if err != nil || len(items) != 3 {
		t.Fatalf("guest draft filtering after migration: %d %v", len(items), err)
	}
	if _, err := db.Exec("INSERT INTO programme_activities(event_id,position,type) VALUES(1,0,'vote')"); err == nil {
		t.Fatal("migration allowed two activities in one event")
	}
	if _, err := db.Exec("INSERT INTO events(title,description,teaser) SELECT 'Existing item','','' FROM generate_series(1,200)"); err != nil {
		t.Fatal(err)
	}
	items, err = service.List(t.Context(), now, 3, true)
	if err != nil || len(items) != 204 {
		t.Fatalf("migration expansion truncated existing events: %d %v", len(items), err)
	}
}
