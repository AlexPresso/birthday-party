package programme

import (
	"context"
	"strings"
	"unicode/utf8"
)

const QuestionLimit = 200
const JokerLimit = 2

const (
	ErrInvalidQuestion ActivityError = "invalid_question"
	ErrQuestionsClosed ActivityError = "questions_closed"
	ErrQuestionLimit   ActivityError = "question_limit_reached"
	ErrNoJokers        ActivityError = "no_jokers_left"
)

// RoundStatus is the host-controlled phase of a question round.
type RoundStatus string

const (
	RoundDraft  RoundStatus = "draft"
	RoundOpen   RoundStatus = "open"
	RoundClosed RoundStatus = "closed"
)

// QuestionStatus records how the host resolved a question; resolutions are terminal.
type QuestionStatus string

const (
	QuestionPending  QuestionStatus = "pending"
	QuestionAnswered QuestionStatus = "answered"
	QuestionJoker    QuestionStatus = "joker"
)

type QuestionSummary struct {
	Status        RoundStatus `json:"status"`
	JokersUsed    int         `json:"jokersUsed"`
	QuestionCount int         `json:"questionCount"`
}

// Question deliberately excludes author and voter identities from every audience.
type Question struct {
	ID      int64          `json:"id"`
	Body    string         `json:"body"`
	Status  QuestionStatus `json:"status"`
	Votes   int            `json:"votes"`
	Upvoted bool           `json:"upvoted"`
}

type QuestionRound struct {
	QuestionSummary
	Revision int64      `json:"revision"`
	Items    []Question `json:"items"`
}

func (round QuestionRound) CheckTransition(status RoundStatus, revision int64) error {
	if revision != round.Revision {
		return ErrActivityConflict
	}
	if round.Status == RoundDraft && status == RoundOpen || round.Status == RoundOpen && status == RoundClosed {
		return nil
	}
	return ErrActivityConflict
}

func (round QuestionRound) CheckResolution(current, next QuestionStatus, revision int64) error {
	if revision != round.Revision || round.Status == RoundDraft || current != QuestionPending {
		return ErrActivityConflict
	}
	if next != QuestionAnswered && next != QuestionJoker {
		return ErrInvalidQuestion
	}
	if next == QuestionJoker && round.JokersUsed >= JokerLimit {
		return ErrNoJokers
	}
	return nil
}

type QuestionRepository interface {
	ReadQuestions(context.Context, Actor, int64, bool) (QuestionRound, error)
	AddQuestion(context.Context, Actor, int64, string, int) (QuestionRound, error)
	UpvoteQuestion(context.Context, Actor, int64, int64, bool) (QuestionRound, error)
	TransitionQuestions(context.Context, Actor, int64, RoundStatus, int64) (QuestionRound, error)
	ResolveQuestion(context.Context, Actor, int64, int64, QuestionStatus, int64) (QuestionRound, error)
}

type QuestionService struct{ repository QuestionRepository }

func NewQuestions(repository QuestionRepository) *QuestionService {
	return &QuestionService{repository: repository}
}
func (s *QuestionService) Read(ctx context.Context, actor Actor, id int64, admin bool) (QuestionRound, error) {
	return s.repository.ReadQuestions(ctx, actor, id, admin)
}
func (s *QuestionService) Add(ctx context.Context, actor Actor, id int64, body string) (QuestionRound, error) {
	body = strings.TrimSpace(body)
	if body == "" || utf8.RuneCountInString(body) > 1000 {
		return QuestionRound{}, ErrInvalidQuestion
	}
	return s.repository.AddQuestion(ctx, actor, id, body, QuestionLimit)
}
func (s *QuestionService) Upvote(ctx context.Context, actor Actor, id, questionID int64, upvoted bool) (QuestionRound, error) {
	return s.repository.UpvoteQuestion(ctx, actor, id, questionID, upvoted)
}
func (s *QuestionService) Transition(ctx context.Context, actor Actor, id int64, status RoundStatus, revision int64) (QuestionRound, error) {
	return s.repository.TransitionQuestions(ctx, actor, id, status, revision)
}
func (s *QuestionService) Resolve(ctx context.Context, actor Actor, id, questionID int64, status QuestionStatus, revision int64) (QuestionRound, error) {
	return s.repository.ResolveQuestion(ctx, actor, id, questionID, status, revision)
}
