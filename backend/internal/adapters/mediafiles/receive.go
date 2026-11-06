package mediafiles

import (
	"birthday-party/backend/internal/media"
	"bytes"
	"image"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

func (f *Files) Receive(reader *multipart.Reader, maxImageBytes, maxVideoBytes int64) (media.Received, error) {
	var upload media.Received
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		return upload, &media.Error{Code: "photo_required"}
	}
	upload.Filename = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, part.FileName())
	filename := []rune(upload.Filename)
	upload.Filename = string(filename[:min(len(filename), 240)])
	if upload.Filename == "" {
		upload.Filename = "media"
	}
	input, err := os.CreateTemp(filepath.Join(f.root, "tmp"), "receive-")
	if err != nil {
		return upload, err
	}
	upload.Path = input.Name()
	retained := false
	defer func() {
		input.Close()
		if !retained {
			os.Remove(upload.Path)
		}
	}()
	header := make([]byte, 512)
	n, readErr := io.ReadFull(part, header)
	header = header[:n]
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return upload, &media.Error{Code: "photo_upload_failed"}
	}
	upload.Format = detectVideoFormat(header)
	upload.Kind = "image"
	limit, tooLarge := maxImageBytes, "photo_too_large"
	if upload.Format != "" {
		upload.Kind, limit, tooLarge = "video", maxVideoBytes, "video_too_large"
	}
	upload.Size, err = io.Copy(input, io.LimitReader(io.MultiReader(bytes.NewReader(header), part), limit+1))
	if upload.Size > limit {
		return upload, &media.Error{Code: tooLarge}
	}
	if err != nil {
		return upload, &media.Error{Code: "photo_upload_failed"}
	}
	if upload.Size == 0 {
		return upload, &media.Error{Code: "photo_required"}
	}
	if _, err = reader.NextPart(); err != io.EOF {
		return upload, &media.Error{Code: "single_photo_required"}
	}
	if upload.Kind == "image" {
		if _, err = input.Seek(0, io.SeekStart); err != nil {
			return upload, err
		}
		config, format, decodeErr := image.DecodeConfig(input)
		if decodeErr != nil || (format != "jpeg" && format != "png" && format != "webp") {
			return upload, &media.Error{Code: "unsupported_photo_type"}
		}
		if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > media.MaxPhotoPixels {
			return upload, &media.Error{Code: "photo_dimensions_too_large"}
		}
		upload.Format = format
	}
	if err = input.Sync(); err != nil {
		return upload, err
	}
	if err = input.Close(); err != nil {
		return upload, err
	}
	retained = true
	return upload, nil
}
