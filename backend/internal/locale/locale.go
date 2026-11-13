// Package locale lists the languages the application is translated into.
package locale

import "slices"

var supported = []string{"en", "fr", "de", "it", "es"}

// Supported returns the base language tags that have translations.
func Supported() []string { return slices.Clone(supported) }

// IsSupported reports whether tag is exactly one of the supported base tags.
func IsSupported(tag string) bool { return slices.Contains(supported, tag) }
