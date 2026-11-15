package mediafiles

import "birthday-party/backend/internal/media"

// Space reports the size and free room of the disk holding the private data
// directory. Free room is what an unprivileged process may still write.
func (f *Files) Space() (media.Storage, error) { return diskSpace(f.root) }
