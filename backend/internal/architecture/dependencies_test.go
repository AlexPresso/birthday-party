package architecture_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Core packages may depend on each other, on the shared pure conventions
// (timestamp, locale) and on transport-independent standard library types.
// Storage, HTTP, filesystem and vendor SDK dependencies belong in adapters.
// Parse every production file, including files for other build targets.
func TestCoreDependenciesPointInward(t *testing.T) {
	const module = "birthday-party/backend/"
	corePackages := map[string]bool{
		"access": true, "guestbook": true, "identity": true,
		"media": true, "notifications": true, "party": true,
		"profile": true, "programme": true, "welcome": true,
		// API conventions shared by features; they obey the same rules.
		"locale": true, "timestamp": true,
	}
	for name := range corePackages {
		t.Run(name, func(t *testing.T) {
			files := 0
			err := filepath.WalkDir(filepath.Join("..", name), func(path string, entry fs.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
					return nil
				}
				files++
				parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
				if err != nil {
					return err
				}
				for _, spec := range parsed.Imports {
					dependency, err := strconv.Unquote(spec.Path.Value)
					if err != nil {
						return err
					}
					if strings.HasPrefix(dependency, module) {
						local := strings.TrimPrefix(dependency, module+"internal/")
						feature, _, _ := strings.Cut(local, "/")
						if !corePackages[feature] {
							t.Errorf("%s imports outer package %q; depend on a core port instead", path, dependency)
						}
						continue
					}
					first, _, _ := strings.Cut(dependency, "/")
					if strings.Contains(first, ".") || dependency == "C" {
						t.Errorf("%s imports infrastructure dependency %q; keep external SDKs in adapters", path, dependency)
						continue
					}
					for _, outer := range []string{"database/sql", "net/http", "os", "syscall"} {
						if dependency == outer || strings.HasPrefix(dependency, outer+"/") {
							t.Errorf("%s imports infrastructure package %q; depend on a core port instead", path, dependency)
						}
					}
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if files == 0 {
				t.Fatal("core package has no production files; update the architecture boundary list")
			}
		})
	}
}
