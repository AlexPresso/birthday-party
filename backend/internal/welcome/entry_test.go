package welcome

import "testing"

func TestWaitingGuestsEnterOnlyTheFirstAvailableStep(t *testing.T) {
	for _, test := range []struct {
		name     string
		state    State
		progress Progress
		position int
		entered  bool
	}{
		{"first unlock", State{Generation: 3, CurrentStep: 1}, Progress{Generation: 3, Revision: 41}, 1, true},
		{"reconnect after several unlocks", State{Generation: 3, CurrentStep: 3}, Progress{Generation: 3, Revision: 41}, 1, true},
		{"host opens while guest is waiting", State{Open: true, Generation: 3, CurrentStep: 3}, Progress{Generation: 3, Revision: 41}, 1, true},
		{"first step remains locked", State{Generation: 3}, Progress{Generation: 3, Revision: 41}, 0, false},
		{"first step already selected", State{Generation: 3, CurrentStep: 3}, Progress{Generation: 3, Position: 1, Revision: 41}, 1, false},
		{"later step already selected", State{Generation: 3, CurrentStep: 3}, Progress{Generation: 3, Position: 2, Revision: 41}, 2, false},
		{"completed empty welcome", State{Open: true, Generation: 3, CurrentStep: 1}, Progress{Generation: 3, Revision: 41, Completed: true}, 0, false},
		{"different run", State{Generation: 3, CurrentStep: 1}, Progress{Generation: 2, Revision: 41}, 0, false},
		{"before the first run", State{Open: true}, Progress{}, 0, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			progress, entered := EnterFirstStep(test.state, test.progress)
			want := test.progress
			want.Position = test.position
			if progress != want || entered != test.entered {
				t.Fatalf("progress=%+v entered=%v, want progress=%+v entered=%v", progress, entered, want, test.entered)
			}
			if repeated, enteredAgain := EnterFirstStep(test.state, progress); repeated != progress || enteredAgain {
				t.Fatalf("repeated refresh changed progress: progress=%+v entered=%v", repeated, enteredAgain)
			}
		})
	}
}

func TestFirstStepEntryPreservesLateArrivalRules(t *testing.T) {
	for _, test := range []struct {
		name      string
		open      bool
		required  bool
		position  int
		completed bool
	}{
		{"optional guest joins current step", false, false, 3, false},
		{"required guest joins first step", false, true, 1, false},
		{"optional guest enters open application", true, false, 3, true},
		{"required guest follows open welcome", true, true, 1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := State{Generation: 3, CurrentStep: 3, Open: test.open, Required: test.required}
			initial := InitialProgress(state)
			progress, entered := EnterFirstStep(state, initial)
			if entered || progress != initial || progress.Position != test.position || progress.Completed != test.completed {
				t.Fatalf("late arrival changed: progress=%+v entered=%v", progress, entered)
			}
		})
	}
}
