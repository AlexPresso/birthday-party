// Package media owns gallery permissions and durable upload workflows.
package media

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/welcome"
)

const MaxPhotoPixels = 40_000_000
const MaxStoredBytes int64 = 10 << 30
const MaxGuestUploads = 100
const MaxQueuedUploads = 1000
const MaxQueuedBytes int64 = 10 << 30
const HistoryTTL = 24 * time.Hour
const QueryTimeout = 5 * time.Second

var ErrNotFound = errors.New("media record not found")
var ErrNoWork = errors.New("no queued media upload")
var ErrSuperseded = errors.New("upload processing attempt was superseded")

// Error is a stable media failure code, independent of its transport status.
type Error struct{ Code string }

func (e *Error) Error() string { return e.Code }

// Kind is the broad type of a file, decided by inspecting its content.
type Kind string

const (
	KindImage Kind = "image"
	KindVideo Kind = "video"
)

// Status is the state of an upload job in the durable queue.
type Status string

const (
	StatusQueued     Status = "queued"
	StatusProcessing Status = "processing"
	StatusReady      Status = "ready"
	StatusFailed     Status = "failed"
)

type Photo struct {
	ID           int64           `json:"id"`
	CategoryID   *int64          `json:"categoryId"`
	Author       identity.Author `json:"author"`
	Width        int             `json:"width"`
	Height       int             `json:"height"`
	CreatedAt    string          `json:"createdAt"`
	URL          string          `json:"url"`
	ThumbnailURL string          `json:"thumbnailUrl"`
	Kind         Kind            `json:"kind"`
	MIMEType     string          `json:"mimeType"`
}

func (p *Photo) SetURLs() {
	p.Kind = KindImage
	if strings.HasPrefix(p.MIMEType, "video/") {
		p.Kind = KindVideo
	}
	p.URL = "/api/photos/" + strconv.FormatInt(p.ID, 10) + "/image"
	p.ThumbnailURL = p.URL + "?size=thumb"
}

type Category struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	IsPublic     bool   `json:"isPublic"`
	CoverPhotoID *int64 `json:"-"`
}

type Upload struct {
	ID                 int64   `json:"id"`
	ClientUploadID     string  `json:"clientUploadId"`
	Status             Status  `json:"status"`
	Filename           string  `json:"filename"`
	Kind               Kind    `json:"kind"`
	CreatedAt          string  `json:"createdAt"`
	ErrorCode          *string `json:"errorCode"`
	Photo              *Photo  `json:"photo"`
	CategoryID         *int64  `json:"categoryId"`
	WelcomeRevision    *int64  `json:"welcomeRevision"`
	WelcomeWidgetIndex *int64  `json:"welcomeWidgetIndex"`
}

// Pending is a claimed job. Attempt names this claim, so a superseded worker
// cannot settle the job, and Attempts counts every claim including this one.
type Pending struct {
	ID, GuestID          int64
	Key, Format, Attempt string
	Kind                 Kind
	Attempts             int
}
type Received struct {
	Path, Filename, Format string
	Kind                   Kind
	Size                   int64
}
type Destination struct {
	CategoryID, WelcomeRevision, WelcomeWidgetIndex *int64
	SessionHash                                     string
}

// File locates a published photo's private files. Created is when it was published.
type File struct {
	Filename, Thumbnail, MIME string
	AuthorID                  int64
	Created                   time.Time
}
type Output struct {
	Filename, Thumbnail, MIME string
	Width, Height             int
	Bytes                     int64
}
type Inventory struct{ Inputs, Photos map[string]bool }
type UploadContext struct {
	Revision    int64     `json:"revision"`
	WidgetIndex int       `json:"widgetIndex"`
	Category    *Category `json:"category"`
}

// Repository commits each mutation atomically, including fresh authorization.
// The bool returned by Accept and Publish records whether commit was attempted;
// ambiguous commit errors must retain files until recovery determines ownership.
type Repository interface {
	Photos(context.Context, identity.Guest, *int64, int64, int) ([]Photo, error)
	PhotoFile(context.Context, identity.Guest, int64) (File, error)
	DeletePhoto(context.Context, identity.Guest, int64) (File, error)
	Categories(context.Context, bool) ([]Category, error)
	SaveCategory(context.Context, Category) (Category, error)
	UploadContext(context.Context, int64, int) (UploadContext, error)
	Inspect(context.Context, int64, string, *Destination) (*Upload, error)
	Accept(context.Context, int64, string, string, Received, Destination, func() error) (Upload, bool, error)
	Upload(context.Context, int64, int64) (Upload, error)
	Recent(context.Context, int64, time.Time) ([]Upload, error)
	// Claim takes the queued job that became available first and counts the attempt.
	Claim(ctx context.Context, attempt string) (Pending, error)
	Publish(context.Context, Pending, Output) (bool, error)
	Ready(context.Context, int64) (bool, error)
	// Requeue returns a claimed job to the queue; it can be claimed from available on.
	Requeue(ctx context.Context, job Pending, now, available time.Time) (bool, error)
	Fail(context.Context, Pending, string, time.Time) (bool, error)
	CleanHistory(context.Context, time.Time) ([]int64, error)
}

// Files provides bounded private storage and processing without exposing paths
// to browsers. Accepted inputs survive until publication or confirmed rejection.
type Files interface {
	StageInput(Received, string) error
	RemoveInput(string)
	RemoveAttempt(Pending)
	Prepare(context.Context, Pending) (Output, error)
	RemovePublished(File) error
	OpenPublished(string) (io.ReadSeekCloser, error)
}

type Service struct {
	repo        Repository
	files       Files
	now         func() time.Time
	notify      func(int64)
	logf        func(string, ...any)
	recordRetry time.Duration
}

func New(repo Repository, files Files, now func() time.Time, notify func(int64), logf func(string, ...any)) *Service {
	return &Service{repo: repo, files: files, now: now, notify: notify, logf: logf, recordRetry: recordRetryInterval}
}

func NewUploadID() (string, error) {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", err
	}
	data[6] = (data[6] & 0x0f) | 0x40
	data[8] = (data[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", data[0:4], data[4:6], data[6:8], data[8:10], data[10:16]), nil
}

func SameOptionalID(a, b *int64) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func SameDestination(job Upload, destination Destination) error {
	if !SameOptionalID(job.WelcomeRevision, destination.WelcomeRevision) || !SameOptionalID(job.WelcomeWidgetIndex, destination.WelcomeWidgetIndex) {
		return &Error{Code: "welcome_conflict"}
	}
	if !SameOptionalID(job.CategoryID, destination.CategoryID) {
		return &Error{Code: "invalid_media_category"}
	}
	return nil
}

// AuthorizeDestination runs against the guest's locked current welcome snapshot.
func AuthorizeDestination(guest identity.Guest, view welcome.View, destination *Destination) error {
	var selected *welcome.Widget
	var hasMedia bool
	if view.Step != nil {
		for i := range view.Step.Widgets {
			widget := &view.Step.Widgets[i]
			hasMedia = hasMedia || widget.Type == welcome.WidgetMediaUpload
			if destination.WelcomeWidgetIndex != nil && int64(i) == *destination.WelcomeWidgetIndex {
				selected = widget
			}
		}
	}
	if destination.WelcomeRevision != nil {
		if view.Open || selected == nil || selected.Type != welcome.WidgetMediaUpload || view.ProgressRevision != *destination.WelcomeRevision {
			return &Error{Code: "welcome_conflict"}
		}
		categoryID := selected.MediaUpload.CategoryID
		if destination.CategoryID != nil && !SameOptionalID(destination.CategoryID, categoryID) {
			return &Error{Code: "invalid_media_category"}
		}
		destination.CategoryID = categoryID
	} else if !guest.IsAdmin() && !view.Open {
		if hasMedia {
			return &Error{Code: "invalid_body"}
		}
		return &Error{Code: "welcome_required"}
	}
	return nil
}

func (s *Service) Photos(ctx context.Context, guest identity.Guest, category *int64, before int64, limit int) ([]Photo, error) {
	return s.repo.Photos(ctx, guest, category, before, limit)
}
func (s *Service) PhotoFile(ctx context.Context, guest identity.Guest, id int64) (File, error) {
	return s.repo.PhotoFile(ctx, guest, id)
}
func (s *Service) OpenPublished(name string) (io.ReadSeekCloser, error) {
	return s.files.OpenPublished(name)
}
func (s *Service) DeletePhoto(ctx context.Context, guest identity.Guest, id int64) error {
	current, err := s.repo.PhotoFile(ctx, guest, id)
	if err != nil {
		return err
	}
	if guest.ID != current.AuthorID && !guest.IsAdmin() {
		return &Error{Code: "photo_delete_forbidden"}
	}
	file, err := s.repo.DeletePhoto(ctx, guest, id)
	if err != nil {
		return err
	}
	if err := s.files.RemovePublished(file); err != nil {
		s.logf("remove private photo %d: %v", id, err)
	}
	s.notify(file.AuthorID)
	return nil
}

func ValidateQueueCapacity(total, owned int, bytes, incoming int64) error {
	if total >= MaxQueuedUploads || owned >= MaxGuestUploads || incoming > MaxQueuedBytes-bytes {
		return &Error{Code: "upload_queue_full"}
	}
	return nil
}

func ValidateAlbumCapacity(count int, bytes, incoming int64) error {
	if count >= 5000 || incoming > MaxStoredBytes-bytes {
		return &Error{Code: "album_full"}
	}
	return nil
}
func (s *Service) Categories(ctx context.Context, admin bool) ([]Category, error) {
	return s.repo.Categories(ctx, admin)
}
func (s *Service) SaveCategory(ctx context.Context, category Category) (Category, error) {
	category.Name = strings.TrimSpace(category.Name)
	if category.Name == "" || utf8.RuneCountInString(category.Name) > 80 {
		return Category{}, &Error{Code: "invalid_media_category"}
	}
	return s.repo.SaveCategory(ctx, category)
}
func (s *Service) UploadContext(ctx context.Context, guestID int64, index int) (UploadContext, error) {
	return s.repo.UploadContext(ctx, guestID, index)
}
func (s *Service) Inspect(ctx context.Context, guestID int64, clientID string, destination *Destination) (*Upload, error) {
	return s.repo.Inspect(ctx, guestID, clientID, destination)
}
func (s *Service) Upload(ctx context.Context, id, guestID int64) (Upload, error) {
	return s.repo.Upload(ctx, id, guestID)
}
func (s *Service) Recent(ctx context.Context, guestID int64) ([]Upload, error) {
	return s.repo.Recent(ctx, guestID, s.now())
}

func (s *Service) Accept(ctx context.Context, guestID int64, clientID string, input Received, destination Destination) (Upload, error) {
	key, err := identity.NewToken()
	if err != nil {
		return Upload{}, err
	}
	// Promote the received input while the repository holds the quota lock.
	// Recovery must not remove a spool file before its row has been committed.
	job, retain, err := s.repo.Accept(ctx, guestID, clientID, key, input, destination, func() error {
		return s.files.StageInput(input, key)
	})
	if !retain {
		s.files.RemoveInput(key)
	}
	if err == nil {
		s.notify(guestID)
	}
	return job, err
}

func (s *Service) Claim(ctx context.Context) (Pending, error) {
	ctx, cancel := context.WithTimeout(ctx, QueryTimeout)
	defer cancel()
	attempt, err := NewUploadID()
	if err != nil {
		return Pending{}, err
	}
	job, err := s.repo.Claim(ctx, attempt)
	if err == nil {
		s.notify(job.GuestID)
	}
	return job, err
}

func (s *Service) CleanHistory(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, QueryTimeout)
	defer cancel()
	owners, err := s.repo.CleanHistory(ctx, s.now().Add(-HistoryTTL))
	if err != nil {
		return err
	}
	for _, id := range owners {
		s.notify(id)
	}
	return nil
}
