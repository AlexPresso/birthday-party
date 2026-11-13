package mediafiles

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"

	"birthday-party/backend/internal/media"
)

func (f *Files) Prepare(ctx context.Context, job media.Pending) (media.Output, error) {
	inputPath := filepath.Join(f.root, "uploads", job.Key+".input")
	if _, err := os.Stat(inputPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return media.Output{}, &media.Error{Code: "photo_unavailable"}
		}
		return media.Output{}, err
	}
	workDir, err := os.MkdirTemp(filepath.Join(f.root, "tmp"), "process-")
	if err != nil {
		return media.Output{}, err
	}
	defer os.RemoveAll(workDir)
	var prepared preparedMedia
	if job.Kind == media.KindVideo {
		prepared, err = prepareVideo(ctx, inputPath, workDir, job.Format)
	} else {
		input, openErr := os.Open(inputPath)
		if openErr != nil {
			return media.Output{}, openErr
		}
		prepared, err = prepareImage(input, filepath.Join(workDir, "thumb.jpg"))
		input.Close()
	}
	if err != nil {
		return media.Output{}, err
	}
	if err = ctx.Err(); err != nil {
		return media.Output{}, err
	}
	info, err := os.Stat(prepared.path)
	if err != nil {
		return media.Output{}, err
	}
	thumbInfo, err := os.Stat(prepared.thumbnailPath)
	if err != nil {
		return media.Output{}, err
	}
	filename, thumbname := job.Key+"-"+job.Attempt+"."+prepared.extension, job.Key+"-"+job.Attempt+".thumb.jpg"
	finalPath, finalThumb := filepath.Join(f.root, "photos", filename), filepath.Join(f.root, "photos", thumbname)
	output := media.Output{
		Filename: filename, Thumbnail: thumbname, MIME: prepared.mimeType,
		Width: prepared.width, Height: prepared.height, Bytes: info.Size() + thumbInfo.Size(),
	}
	retained := false
	defer func() {
		if !retained {
			f.RemoveAttempt(job)
		}
	}()
	// Copy outside the quota transaction so large files do not delay other receivers.
	// The staged input remains available until both metadata and job status commit.
	if err = copyPrivateFile(prepared.path, finalPath); err != nil {
		return media.Output{}, err
	}
	if err = copyPrivateFile(prepared.thumbnailPath, finalThumb); err != nil {
		return media.Output{}, err
	}
	if err = ctx.Err(); err != nil {
		return media.Output{}, err
	}
	retained = true
	return output, nil
}

func copyPrivateFile(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	if copyErr == nil {
		copyErr = out.Sync()
	}
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
