package app

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestWelcomeWidgetsValidateShapesAndBounds(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	for _, test := range []struct{ name, step, code string }{
		{"missing collection", `{}`, "invalid_welcome_steps"},
		{"null collection", `{"widgets":null}`, "invalid_welcome_steps"},
		{"empty collection", `{"widgets":[]}`, "invalid_welcome_steps"},
		{"old fixed fields", `{"title":"Old title","widgets":[{"type":"profile_photo"}]}`, "invalid_body"},
		{"unknown widget", `{"widgets":[{"type":"gallery"}]}`, "invalid_welcome_action"},
		{"missing type", `{"widgets":[{}]}`, "invalid_welcome_action"},
		{"nonstring type", `{"widgets":[{"type":false}]}`, "invalid_body"},
		{"missing title", `{"widgets":[{"type":"title"}]}`, "invalid_welcome_steps"},
		{"blank title", `{"widgets":[{"type":"title","text":"  "}]}`, "invalid_welcome_steps"},
		{"empty text", `{"widgets":[{"type":"text","text":""}]}`, "invalid_welcome_steps"},
		{"wrong text type", `{"widgets":[{"type":"text","text":12}]}`, "invalid_body"},
		{"unknown field", `{"widgets":[{"type":"title","text":"Title","url":"private"}]}`, "invalid_body"},
		{"unused null text", `{"widgets":[{"type":"profile_photo","text":null}]}`, "invalid_body"},
		{"uppercase unused text", `{"widgets":[{"type":"profile_photo","Text":"unused"}]}`, "invalid_body"},
		{"mixed case unused text", `{"widgets":[{"type":"profile_photo","tExT":"unused"}]}`, "invalid_body"},
		{"uppercase unused settings", `{"widgets":[{"type":"title","text":"Title","MediaUpload":{"categoryId":null}}]}`, "invalid_body"},
		{"mixed case type", `{"widgets":[{"Type":"profile_photo"}]}`, "invalid_body"},
		{"mixed case category", `{"widgets":[{"type":"media_upload","mediaUpload":{"CategoryID":null}}]}`, "invalid_body"},
		{"unused null settings", `{"widgets":[{"type":"text","text":"Text","mediaUpload":null}]}`, "invalid_body"},
		{"duplicate profile", `{"widgets":[{"type":"profile_photo"},{"type":"profile_photo"}]}`, "invalid_welcome_action"},
		{"duplicate notifications", `{"widgets":[{"type":"enable_notifications"},{"type":"enable_notifications"}]}`, "invalid_welcome_action"},
		{"notification settings", `{"widgets":[{"type":"enable_notifications","mediaUpload":null}]}`, "invalid_body"},
		{"notification text", `{"widgets":[{"type":"enable_notifications","text":"Subscribe"}]}`, "invalid_body"},
		{"too many widgets", `{"widgets":[` + strings.TrimSuffix(strings.Repeat(`{"type":"title","text":"Title"},`, 13), ",") + `]}`, "invalid_welcome_steps"},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest("PUT", "/api/admin/welcome", strings.NewReader(`{"revision":0,"steps":[`+test.step+`]}`))
			r.Header.Set("X-Requested-With", "birthday-party")
			r.AddCookie(host)
			assertWelcomeError(t, performMediaUpload(a, r), 400, test.code)
		})
	}
	state := readWelcomeState(t, request(t, a, "GET", "/api/admin/welcome", nil, host))
	if state.Revision != 0 || len(state.Steps) != 0 {
		t.Fatal("invalid widgets changed persisted state")
	}
	// A step may consist solely of a profile editor or text; no fixed title is required.
	steps := []welcomeStep{{Widgets: []welcomeWidget{{Type: "profile_photo"}}}, {Widgets: []welcomeWidget{
		{Type: "text", Text: "  An opening paragraph.\nKeep this line.  "},
		{Type: "title", Text: "  A later title  "},
		{Type: "text", Text: "Another paragraph"},
		{Type: "title", Text: "A second title"},
	}}}
	saved := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	steps[1].Widgets[0].Text = "An opening paragraph.\nKeep this line."
	steps[1].Widgets[1].Text = "A later title"
	if !reflect.DeepEqual(saved.Steps, steps) {
		t.Fatalf("widget order or authored text changed: %+v", saved.Steps)
	}
}

func TestWelcomeWidgetsAcceptMaximumBoundedCollection(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	steps := make([]welcomeStep, 12)
	for i := range steps {
		steps[i].Widgets = make([]welcomeWidget, 12)
		for j := range steps[i].Widgets {
			steps[i].Widgets[j] = welcomeWidget{Type: "text", Text: strings.Repeat("🙂", 1000)}
		}
	}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	if !reflect.DeepEqual(steps, state.Steps) {
		t.Fatal("maximum valid collection did not round trip")
	}
}

func TestWelcomeWidgetsIsolateUploadDestinationsAndAllowProfileAlongside(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Widget guest")
	other, _, _ := guest(t, a, host, "Other widget guest")
	otherProfile := profileGuest(t, uploadAvatar(t, a, other, pngBytes(t)))
	category := createTestCategory(t, a, host, "Host contributions", false)
	steps := []welcomeStep{{Widgets: []welcomeWidget{
		{Type: "profile_photo"},
		{Type: "media_upload", MediaUpload: &welcomeMediaUpload{CategoryID: &category.ID}},
		{Type: "text", Text: "A second destination below"},
		{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}},
		{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}},
	}}}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	state = changeWelcome(t, a, host, state.Revision, "next")
	progressRevision := selectGuestWelcomeStep(t, a, visitor, 1).ProgressRevision
	for _, index := range []int{1, 3, 4} {
		response := request(t, a, "GET", "/api/welcome/upload-context?widgetIndex="+strconv.Itoa(index), nil, visitor)
		status(t, response, 200)
		var context struct {
			Revision    int64          `json:"revision"`
			WidgetIndex int            `json:"widgetIndex"`
			Category    *MediaCategory `json:"category"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &context); err != nil {
			t.Fatal(err)
		}
		if context.Revision != progressRevision || context.WidgetIndex != index || index == 1 && (context.Category == nil || context.Category.ID != category.ID || context.Category.IsPublic) || index != 1 && context.Category != nil {
			t.Fatalf("wrong widget context: %s", response.Body.String())
		}
	}
	for _, query := range []string{"", "widgetIndex=", "widgetIndex=-1", "widgetIndex=12", "widgetIndex=1.5", "widgetIndex=%zz", "widgetIndex=1&widgetIndex=3", "widgetIndex=1;widgetIndex=3"} {
		assertWelcomeError(t, request(t, a, "GET", "/api/welcome/upload-context?"+query, nil, visitor), 400, "invalid_body")
	}
	for _, index := range []string{"0", "2", "5", "11"} {
		assertWelcomeError(t, request(t, a, "GET", "/api/welcome/upload-context?widgetIndex="+index, nil, visitor), 423, "welcome_required")
		r := mediaUploadRequest(t, visitor, nil, &progressRevision, "")
		r.Header.Set("X-Welcome-Widget-Index", index)
		assertWelcomeError(t, performMediaUpload(a, r), 409, "welcome_conflict")
	}
	for _, index := range []string{"", "-1", "12", "1.5", "invalid"} {
		r := mediaUploadRequest(t, visitor, nil, &progressRevision, "")
		r.Header.Set("X-Welcome-Widget-Index", index)
		assertWelcomeError(t, performMediaUpload(a, r), 400, "invalid_body")
	}
	for _, missing := range []string{"X-Welcome-Revision", "X-Welcome-Widget-Index"} {
		r := mediaUploadRequest(t, visitor, nil, &progressRevision, "")
		r.Header.Del(missing)
		assertWelcomeError(t, performMediaUpload(a, r), 400, "invalid_body")
	}
	for _, duplicated := range []string{"X-Welcome-Revision", "X-Welcome-Widget-Index"} {
		r := mediaUploadRequest(t, visitor, nil, &progressRevision, "")
		r.Header.Add(duplicated, "1")
		assertWelcomeError(t, performMediaUpload(a, r), 400, "invalid_body")
	}
	status(t, request(t, a, "GET", "/api/profile", nil, visitor), 200)
	profile := profileGuest(t, uploadAvatar(t, a, visitor, pngBytes(t)))
	status(t, request(t, a, "HEAD", *profile.AvatarURL, nil, visitor), 200)
	assertWelcomeError(t, request(t, a, "GET", *otherProfile.AvatarURL, nil, visitor), 423, "welcome_required")
	assertWelcomeError(t, request(t, a, "GET", "/api/photos", nil, visitor), 423, "welcome_required")
	privateID := "11111111-1111-4111-8111-111111111111"
	mainID := "22222222-2222-4222-8222-222222222222"
	privateResponse := performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &progressRevision, privateID))
	status(t, privateResponse, 202)
	privateJob := parseJob(t, privateResponse)
	mainRequest := mediaUploadRequest(t, visitor, nil, &progressRevision, mainID)
	mainRequest.Header.Set("X-Welcome-Widget-Index", "3")
	mainResponse := performMediaUpload(a, mainRequest)
	status(t, mainResponse, 202)
	mainJob := parseJob(t, mainResponse)
	if privateJob.WelcomeWidgetIndex == nil || *privateJob.WelcomeWidgetIndex != 1 || mainJob.WelcomeWidgetIndex == nil || *mainJob.WelcomeWidgetIndex != 3 || privateJob.CategoryID == nil || *privateJob.CategoryID != category.ID || mainJob.CategoryID != nil {
		t.Fatal("accepted jobs lost their widget or destination")
	}
	for _, index := range []string{"1", "4"} {
		r := mediaUploadRequest(t, visitor, nil, &progressRevision, mainID)
		r.Header.Set("X-Welcome-Widget-Index", index)
		assertWelcomeError(t, performMediaUpload(a, r), 409, "welcome_conflict")
	}
	retry := mediaUploadRequest(t, visitor, nil, &progressRevision, mainID)
	retry.Header.Set("X-Welcome-Widget-Index", "3")
	if parseJob(t, performMediaUpload(a, retry)).ID != mainJob.ID {
		t.Fatal("retry duplicated a widget upload")
	}
	privatePhoto := finishCategoryUpload(t, a, privateResponse)
	mainPhoto := finishCategoryUpload(t, a, mainResponse)
	if privatePhoto.CategoryID == nil || *privatePhoto.CategoryID != category.ID || mainPhoto.CategoryID != nil {
		t.Fatal("processing merged widget destinations")
	}
	for _, id := range []int64{privateJob.ID, mainJob.ID} {
		job := parseJob(t, request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(id, 10), nil, visitor))
		if job.Photo != nil || job.Status != "ready" || job.WelcomeWidgetIndex == nil {
			t.Fatal("closed widget queue exposed media or lost its identity")
		}
	}
	changeWelcome(t, a, host, state.Revision, "open")
	moveGuestWelcome(t, a, visitor, "finish")
	status(t, request(t, a, "GET", privatePhoto.URL, nil, visitor), 404)
	status(t, request(t, a, "GET", mainPhoto.URL, nil, visitor), 200)
}

func TestWelcomeWidgetsMigrationPreservesContentProgressAndAcceptedJobs(t *testing.T) {
	for _, version := range []int{4, 6} {
		t.Run(strconv.Itoa(version), func(t *testing.T) {
			db := testDatabase(t)
			files := migrationFiles(t)
			for name := range files {
				if name > "migrations/000"+strconv.Itoa(version)+"_zzzz.sql" {
					delete(files, name)
				}
			}
			if err := applyMigrations(t.Context(), db, files); err != nil {
				t.Fatal(err)
			}
			legacy := `[{"title":"First title","body":"Authored\ntext"},{"title":"Second title","body":""}]`
			want := []welcomeStep{testWelcomeStep("First title", "Authored\ntext"), testWelcomeStep("Second title", "")}
			if version == 6 {
				categoryID := int64(1)
				legacy = `[{"title":"First title","body":"Authored\ntext","action":"profile_photo"},{"title":"Second title","body":"","action":"media_upload","mediaUpload":{"categoryId":1}},{"title":"Main gallery","body":"Other text","action":"media_upload","mediaUpload":{"categoryId":null}}]`
				want = []welcomeStep{testWelcomeStep("First title", "Authored\ntext", welcomeWidget{Type: "profile_photo"}), testWelcomeStep("Second title", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{CategoryID: &categoryID}}), testWelcomeStep("Main gallery", "Other text", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}})}
				for _, statement := range []string{
					`INSERT INTO guests(id,name,role) VALUES(1,'Existing guest','guest')`,
					`INSERT INTO media_categories(id,name,is_public) VALUES(1,'Existing private category',false)`,
					`INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,created_at,updated_at,category_id,welcome_revision) VALUES(1,'existing-id','queued','existing.png','image','png','existing-key',100,'2026-10-15T12:00:00Z','2026-10-15T12:00:00Z',1,8)`,
				} {
					if _, err := db.Exec(statement); err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := db.Exec(`UPDATE welcome SET is_open=false,revision=8,current_step=2,steps=$1::jsonb WHERE id=1`, legacy); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := migrate(t.Context(), db); err != nil {
					t.Fatal(err)
				}
				state, err := scanWelcome(db.QueryRow(welcomeSelect))
				if err != nil {
					t.Fatal(err)
				}
				if state.Open || state.Revision != 10 || state.CurrentStep != 2 || !reflect.DeepEqual(state.Steps, want) {
					t.Fatalf("migration changed authored content or progress: %+v", state)
				}
			}
			if version == 6 {
				var preserved bool
				if err := db.QueryRow(`SELECT status='queued' AND category_id=1 AND welcome_revision=8 AND welcome_widget_index IS NULL AND storage_key='existing-key' AND byte_size=100 FROM upload_jobs`).Scan(&preserved); err != nil || !preserved {
					t.Fatalf("migration changed an accepted upload: preserved=%v error=%v", preserved, err)
				}
			}
		})
	}
}
