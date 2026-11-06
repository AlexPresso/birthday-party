package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
)

// Handler returns the API router with authentication and mutation origin checks.
func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/config", a.getPublicConfiguration)
	mux.HandleFunc("GET /api/admin/config", a.auth(true, a.getConfiguration))
	mux.HandleFunc("PUT /api/admin/config", a.auth(true, a.updateConfiguration))
	mux.HandleFunc("POST /api/invitations/preview", a.previewInvitation)
	mux.HandleFunc("POST /api/invitations/accept", a.acceptInvitation)
	mux.HandleFunc("GET /api/session", a.auth(false, func(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
		respond(w, 200, map[string]any{"guest": guest})
	}))
	mux.HandleFunc("POST /api/logout", a.auth(false, a.logout))
	mux.HandleFunc("GET /api/realtime", a.realtimeHTTP)
	mux.HandleFunc("GET /api/notifications", a.auth(false, a.getNotifications))
	mux.HandleFunc("POST /api/notifications/status", a.auth(false, a.notificationStatus))
	mux.HandleFunc("PUT /api/notifications/subscription", a.auth(false, a.saveNotificationSubscription))
	mux.HandleFunc("DELETE /api/notifications/subscription", a.auth(false, a.deleteNotificationSubscription))
	mux.HandleFunc("GET /api/profile", a.authProfile(a.getProfile))
	mux.HandleFunc("PUT /api/profile/avatar", a.authProfile(a.updateAvatar))
	mux.HandleFunc("DELETE /api/profile/avatar", a.authProfile(a.deleteAvatar))
	mux.HandleFunc("GET /api/guests/{id}/avatar", a.authProfile(a.serveAvatar))
	mux.HandleFunc("GET /api/welcome", a.auth(false, a.getWelcome))
	mux.HandleFunc("POST /api/welcome/progress", a.auth(false, a.transitionGuestWelcome))
	mux.HandleFunc("GET /api/welcome/upload-context", a.auth(false, a.getWelcomeUploadContext))
	mux.HandleFunc("GET /api/admin/welcome", a.auth(true, a.getAdminWelcome))
	mux.HandleFunc("PUT /api/admin/welcome", a.auth(true, a.updateWelcome))
	mux.HandleFunc("PATCH /api/admin/welcome/required", a.auth(true, a.updateWelcomeRequired))
	mux.HandleFunc("POST /api/admin/welcome/transition", a.auth(true, a.transitionWelcome))
	mux.HandleFunc("GET /api/party", a.authContent(a.getParty))
	mux.HandleFunc("PATCH /api/admin/party", a.auth(true, a.updateParty))
	mux.HandleFunc("GET /api/admin/guests", a.auth(true, a.listGuests))
	mux.HandleFunc("POST /api/admin/guests", a.auth(true, a.createGuest))
	mux.HandleFunc("POST /api/admin/guests/{id}/invitation", a.auth(true, a.renewInvitation))
	mux.HandleFunc("DELETE /api/admin/guests/{id}", a.auth(true, a.revokeGuest))
	mux.HandleFunc("GET /api/programme", a.authContent(a.listProgramme))
	mux.HandleFunc("GET /api/admin/programme", a.auth(true, a.listAdminProgramme))
	mux.HandleFunc("POST /api/admin/programme", a.auth(true, a.createEvent))
	mux.HandleFunc("PUT /api/admin/programme/{id}", a.auth(true, a.updateEvent))
	mux.HandleFunc("DELETE /api/admin/programme/{id}", a.auth(true, a.deleteEvent))
	mux.HandleFunc("POST /api/admin/programme/{id}/vote/state", a.auth(true, a.transitionVote))
	mux.HandleFunc("PUT /api/programme/{id}/vote", a.authContent(a.castVote))
	mux.HandleFunc("GET /api/programme/{id}/questions", a.authContent(a.readQuestions))
	mux.HandleFunc("POST /api/programme/{id}/questions", a.authContent(a.addQuestion))
	mux.HandleFunc("PUT /api/programme/{id}/questions/upvote", a.authContent(a.upvoteQuestion))
	mux.HandleFunc("POST /api/admin/programme/{id}/questions/state", a.auth(true, a.transitionQuestions))
	mux.HandleFunc("PUT /api/admin/programme/{id}/questions/resolve", a.auth(true, a.resolveQuestion))
	mux.HandleFunc("GET /api/guestbook", a.authContent(a.listEntries))
	mux.HandleFunc("POST /api/guestbook", a.authContent(a.createEntry))
	mux.HandleFunc("DELETE /api/guestbook/{id}", a.authContent(a.deleteEntry))
	mux.HandleFunc("GET /api/photos", a.authContent(a.listPhotos))
	mux.HandleFunc("GET /api/media-categories", a.authContent(a.listMediaCategories))
	mux.HandleFunc("POST /api/admin/media-categories", a.auth(true, a.saveMediaCategory))
	mux.HandleFunc("PUT /api/admin/media-categories/{id}", a.auth(true, a.saveMediaCategory))
	mux.HandleFunc("POST /api/photos", a.authorize(false, access.Upload, a.uploadPhoto))
	mux.HandleFunc("GET /api/uploads", a.authorize(false, access.Upload, a.listUploads))
	mux.HandleFunc("GET /api/uploads/{id}", a.authorize(false, access.Upload, a.getUpload))
	mux.HandleFunc("GET /api/photos/{id}/image", a.authContent(a.servePhoto))
	mux.HandleFunc("DELETE /api/photos/{id}", a.authContent(a.deletePhoto))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if r.Header.Get("X-Requested-With") != "birthday-party" || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != a.config.PublicURL) {
				fail(w, 403, "request_forbidden")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
