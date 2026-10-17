package welcome

import "slices"

// ReconcileProgress preserves a guest's position after an edit, clamping it when
// steps were removed. The caller assigns a new revision when the returned flag
// is true. Text corrections preserve active widgets and their upload context.
func ReconcileProgress(previous, updated State, progress Progress) (Progress, bool) {
	if progress.Completed || progress.Generation != previous.Generation || progress.Generation != updated.Generation {
		return progress, false
	}
	position := progress.Position
	progress.Position = min(position, updated.CurrentStep)
	changed := position != progress.Position || !slices.EqualFunc(
		activeWidgets(previous, position), activeWidgets(updated, progress.Position), sameWidgetContext,
	)
	return progress, changed
}

func activeWidgets(state State, position int) []Widget {
	if position < 1 || position > state.CurrentStep || position > len(state.Steps) {
		return nil
	}
	return state.Steps[position-1].Widgets
}

func sameWidgetContext(previous, updated Widget) bool {
	if previous.Type != updated.Type {
		return false
	}
	if previous.MediaUpload == nil || updated.MediaUpload == nil {
		return previous.MediaUpload == nil && updated.MediaUpload == nil
	}
	previousCategory, updatedCategory := previous.MediaUpload.CategoryID, updated.MediaUpload.CategoryID
	if previousCategory == nil || updatedCategory == nil {
		return previousCategory == nil && updatedCategory == nil
	}
	return *previousCategory == *updatedCategory
}
