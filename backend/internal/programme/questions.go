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

type QuestionSummary struct {
	Status        string `json:"status"`
	JokersUsed    int    `json:"jokersUsed"`
	QuestionCount int    `json:"questionCount"`
}

// Question deliberately excludes author and voter identities from every audience.
type Question struct {
	ID      int64  `json:"id"`
	Body    string `json:"body"`
	Status  string `json:"status"`
	Votes   int    `json:"votes"`
	Upvoted bool   `json:"upvoted"`
}

type QuestionRound struct {
	QuestionSummary
	Revision int64      `json:"revision"`
	Items    []Question `json:"items"`
}

func (round QuestionRound) CheckTransition(status string, revision int64) error {
	if revision != round.Revision {
		return ErrActivityConflict
	}
	if round.Status == "draft" && status == "open" || round.Status == "open" && status == "closed" {
		return nil
	}
	return ErrActivityConflict
}

func (round QuestionRound) CheckResolution(current, next string, revision int64) error {
	if revision != round.Revision || round.Status == "draft" || current != "pending" {
		return ErrActivityConflict
	}
	if next != "answered" && next != "joker" {
		return ErrInvalidQuestion
	}
	if next == "joker" && round.JokersUsed >= JokerLimit {
		return ErrNoJokers
	}
	return nil
}

type QuestionRepository interface {
	ReadQuestions(context.Context, Actor, int64, bool) (QuestionRound, error)
	AddQuestion(context.Context, Actor, int64, string, int) (QuestionRound, error)
	UpvoteQuestion(context.Context, Actor, int64, int64, bool) (QuestionRound, error)
	TransitionQuestions(context.Context, Actor, int64, string, int64) (QuestionRound, error)
	ResolveQuestion(context.Context, Actor, int64, int64, string, int64) (QuestionRound, error)
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
func (s *QuestionService) Transition(ctx context.Context, actor Actor, id int64, status string, revision int64) (QuestionRound, error) {
	return s.repository.TransitionQuestions(ctx, actor, id, status, revision)
}
func (s *QuestionService) Resolve(ctx context.Context, actor Actor, id, questionID int64, status string, revision int64) (QuestionRound, error) {
	return s.repository.ResolveQuestion(ctx, actor, id, questionID, status, revision)
}
