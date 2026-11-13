// Package media implements the media repository using PostgreSQL transactions.
package media

import (
	"context"
	"database/sql"
	"errors"
	"time"

	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
	"birthday-party/backend/internal/timestamp"
)

// quotaLock serializes queue and gallery capacity decisions within one schema.
const quotaLock = "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func New(db *sql.DB, now func() time.Time) *Store { return &Store{db: db, now: now} }

var _ media.Repository = (*Store)(nil)

func (s *Store) Photos(ctx context.Context, guest identity.Guest, categoryID *int64, before int64, limit int) ([]media.Photo, error) {
	if categoryID != nil {
		var id int64
		err := s.db.QueryRowContext(ctx, "SELECT id FROM media_categories WHERE id=$1 AND (is_public OR $2)", *categoryID, guest.IsAdmin()).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, &media.Error{Code: "media_category_not_found"}
		}
		if err != nil {
			return nil, err
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT p.id,p.category_id,g.id,g.name,p.width,p.height,p.created_at,p.mime,CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END FROM photos p JOIN guests g ON p.guest_id=g.id
 LEFT JOIN media_categories c ON c.id=p.category_id
 WHERE ($1::bigint=0 OR p.id<$1) AND p.category_id IS NOT DISTINCT FROM $3::bigint
 AND (p.category_id IS NULL OR c.is_public OR $4) ORDER BY p.id DESC LIMIT $2`, before, limit+1, categoryID, guest.IsAdmin())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []media.Photo{}
	for rows.Next() {
		var item media.Photo
		var created time.Time
		var avatarVersion int64
		if err := rows.Scan(&item.ID, &item.CategoryID, &item.Author.ID, &item.Author.Name, &item.Width, &item.Height, &created, &item.MIMEType, &avatarVersion); err != nil {
			return nil, err
		}
		item.CreatedAt = timestamp.Format(created)
		item.SetURLs()
		item.Author.AvatarURL = identity.AvatarURL(item.Author.ID, avatarVersion)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) PhotoFile(ctx context.Context, guest identity.Guest, id int64) (media.File, error) {
	var file media.File
	err := s.db.QueryRowContext(ctx, `SELECT p.filename,p.thumbnail,p.mime,p.guest_id,p.created_at FROM photos p LEFT JOIN media_categories c ON c.id=p.category_id
 WHERE p.id=$1 AND (p.category_id IS NULL OR c.is_public OR $2)`, id, guest.IsAdmin()).Scan(&file.Filename, &file.Thumbnail, &file.MIME, &file.AuthorID, &file.Created)
	if errors.Is(err, sql.ErrNoRows) {
		return file, &media.Error{Code: "photo_not_found"}
	}
	return file, err
}

func (s *Store) DeletePhoto(ctx context.Context, guest identity.Guest, id int64) (media.File, error) {
	var file media.File
	err := s.db.QueryRowContext(ctx, `DELETE FROM photos p WHERE p.id=$1 AND (p.guest_id=$3 OR $2) AND
 (p.category_id IS NULL OR $2 OR EXISTS (SELECT 1 FROM media_categories c WHERE c.id=p.category_id AND c.is_public)) RETURNING filename,thumbnail,guest_id`, id, guest.IsAdmin(), guest.ID).Scan(&file.Filename, &file.Thumbnail, &file.AuthorID)
	if errors.Is(err, sql.ErrNoRows) {
		return file, &media.Error{Code: "photo_not_found"}
	}
	return file, err
}

func (s *Store) Categories(ctx context.Context, admin bool) ([]media.Category, error) {
	// Photos are inserted atomically with ready publication, independently of
	// upload history retention. The category paging index bounds each cover lookup.
	rows, err := s.db.QueryContext(ctx, `SELECT c.id,c.name,c.is_public,cover.id
 FROM media_categories c
 LEFT JOIN LATERAL (
   SELECT p.id FROM photos p WHERE p.category_id=c.id AND p.thumbnail<>''
   ORDER BY p.id DESC LIMIT 1
 ) cover ON true
 WHERE c.is_public OR $1 ORDER BY c.id LIMIT 100`, admin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []media.Category{}
	for rows.Next() {
		var item media.Category
		if err := rows.Scan(&item.ID, &item.Name, &item.IsPublic, &item.CoverPhotoID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) SaveCategory(ctx context.Context, category media.Category) (media.Category, error) {
	if category.ID != 0 {
		err := s.db.QueryRowContext(ctx, "UPDATE media_categories SET name=$1,is_public=$2 WHERE id=$3 RETURNING id", category.Name, category.IsPublic, category.ID).Scan(&category.ID)
		if errors.Is(err, sql.ErrNoRows) {
			return category, &media.Error{Code: "media_category_not_found"}
		}
		return category, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return category, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73006)"); err != nil {
		return category, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM media_categories").Scan(&count); err != nil {
		return category, err
	}
	if count >= 100 {
		return category, &media.Error{Code: "media_category_limit"}
	}
	if err = tx.QueryRowContext(ctx, "INSERT INTO media_categories(name,is_public) VALUES($1,$2) RETURNING id", category.Name, category.IsPublic).Scan(&category.ID); err != nil {
		return category, err
	}
	return category, tx.Commit()
}

func (s *Store) UploadContext(ctx context.Context, guestID int64, index int) (media.UploadContext, error) {
	result := media.UploadContext{WidgetIndex: index}
	var categoryID *int64
	var name *string
	var public *bool
	err := s.db.QueryRowContext(ctx, `SELECT p.revision,c.id,c.name,c.is_public
 FROM welcome w JOIN guest_welcome_progress p ON p.guest_id=$2
 LEFT JOIN media_categories c ON c.id=(w.steps->(p.position-1)->'widgets'->$1::integer->'mediaUpload'->>'categoryId')::bigint
 WHERE w.id=1 AND `+pgwelcome.PositionSQL+`
 AND w.steps->(p.position-1)->'widgets'->$1::integer->>'type'='media_upload'`, index, guestID).Scan(&result.Revision, &categoryID, &name, &public)
	if errors.Is(err, sql.ErrNoRows) {
		return result, &media.Error{Code: "welcome_required"}
	}
	if err != nil {
		return result, err
	}
	if categoryID != nil {
		result.Category = &media.Category{ID: *categoryID, Name: *name, IsPublic: *public}
	}
	return result, nil
}

func (s *Store) Ready(ctx context.Context, id int64) (bool, error) {
	var status media.Status
	err := s.db.QueryRowContext(ctx, "SELECT status FROM upload_jobs WHERE id=$1", id).Scan(&status)
	return status == media.StatusReady, err
}

func changed(result sql.Result, err error) (bool, error) {
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

// Requeue only returns the job while the given attempt still owns it.
func (s *Store) Requeue(ctx context.Context, job media.Pending, now, available time.Time) (bool, error) {
	return changed(s.db.ExecContext(ctx, `UPDATE upload_jobs SET status='queued',updated_at=$1,available_at=$2
 WHERE id=$3 AND status='processing' AND attempt_id=$4`, now, available, job.ID, job.Attempt))
}

// Fail only fails the job while the given attempt still owns it.
func (s *Store) Fail(ctx context.Context, job media.Pending, code string, now time.Time) (bool, error) {
	return changed(s.db.ExecContext(ctx, `UPDATE upload_jobs SET status='failed',error_code=$1,updated_at=$2
 WHERE id=$3 AND status='processing' AND attempt_id=$4`, code, now, job.ID, job.Attempt))
}

func (s *Store) CleanHistory(ctx context.Context, before time.Time) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, "DELETE FROM upload_jobs WHERE status IN ('ready','failed') AND updated_at<$1 RETURNING guest_id", before)
	if err != nil {
		return nil, err
	}
	return readOwners(rows)
}

func readOwners(rows *sql.Rows) ([]int64, error) {
	defer rows.Close()
	seen := map[int64]bool{}
	owners := []int64{}
	for rows.Next() {
		var owner int64
		if err := rows.Scan(&owner); err != nil {
			return nil, err
		}
		if !seen[owner] {
			seen[owner] = true
			owners = append(owners, owner)
		}
	}
	return owners, rows.Err()
}

func (s *Store) CategoryOwners(ctx context.Context, categoryID int64) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT DISTINCT guest_id FROM upload_jobs WHERE category_id=$1 LIMIT 500", categoryID)
	if err != nil {
		return nil, err
	}
	return readOwners(rows)
}
