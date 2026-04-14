/** Maximum songs a single table can have pending/playing at once */
export const MAX_SONGS_PER_TABLE = 2;

/** Maximum song duration in seconds (10 minutes) */
export const MAX_SONG_DURATION_SECONDS = 600;

/** Reference amount for scoreboard progress bar (COP) */
export const SCOREBOARD_MAX_CONSUMPTION = 120_000;

/** Priority score factor: total_consumption / this value */
export const PRIORITY_SCORE_DIVISOR = 1000;
