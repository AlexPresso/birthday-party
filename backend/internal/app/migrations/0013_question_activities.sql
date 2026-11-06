ALTER TABLE programme_activities DROP CONSTRAINT programme_activities_type_check;
ALTER TABLE programme_activities ADD CONSTRAINT programme_activities_type_check CHECK (type IN ('vote', 'questions'));

CREATE TABLE programme_question_rounds (
    activity_id BIGINT PRIMARY KEY REFERENCES programme_activities(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    jokers_used INTEGER NOT NULL DEFAULT 0 CHECK (jokers_used BETWEEN 0 AND 2)
);
CREATE TABLE programme_questions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id BIGINT NOT NULL REFERENCES programme_question_rounds(activity_id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'joker'))
);
CREATE INDEX programme_questions_activity ON programme_questions(activity_id, id);
CREATE TABLE programme_question_upvotes (
    question_id BIGINT NOT NULL REFERENCES programme_questions(id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    PRIMARY KEY (question_id, guest_id)
);
