package app

import (
	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/welcome"
)

type welcomeState = welcome.State
type welcomeView = welcome.View
type welcomeStep = welcome.Step
type welcomeWidget = welcome.Widget
type welcomeMediaUpload = welcome.MediaUpload

const welcomeSelect = pgwelcome.Select

var scanWelcome = pgwelcome.Scan
