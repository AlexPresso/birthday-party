-- Werewolf nights -----------------------------------------------------------------
--
-- Players now see whether it is day or night in every game, so the game master
-- switches the phase whether or not ghost messages are on. A game in the lobby
-- is still always in the day.

ALTER TABLE programme_werewolf_games
    DROP CONSTRAINT programme_werewolf_games_night,
    ADD CONSTRAINT programme_werewolf_games_night CHECK (phase = 'day' OR status <> 'lobby');
