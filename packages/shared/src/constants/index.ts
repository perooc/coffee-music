/** Maximum songs a single table can have pending/playing at once */
export const MAX_SONGS_PER_TABLE = 5;

/** Minimum additional consumption (COP) to unlock an extra song beyond the limit */
export const EXTRA_SONG_CONSUMPTION_THRESHOLD = 20_000;

/** Cooldown minutes before a table at the limit can add another song */
export const QUEUE_LIMIT_COOLDOWN_MINUTES = 15;

/**
 * Per-session "song credits" that govern adding a 6th+ song to the queue.
 *
 * Rule:
 *   - Base 5 slots, always available, regardless of consumption.
 *   - When the table reaches 5 active songs, adding another one requires
 *     a "credit". Credits are earned by a SINGLE delivered order whose
 *     subtotal >= EXTRA_SONG_CONSUMPTION_THRESHOLD ($20k). Two small
 *     orders that add up to $20k do NOT earn a credit.
 *   - Each extra song spends one credit. Credits do not stack across
 *     sessions; opening a new session resets the count to 0.
 *   - If admin skips an extra song, the credit is returned (the
 *     spent-count excludes `skipped`).
 *
 * `effectiveSongLimit` returns the actual cap right now: 5 + (earned - spent).
 * `extraCreditsAvailable` is the surplus the table can still spend.
 */
export interface SongCredits {
  /** Delivered orders this session with subtotal >= threshold */
  earned: number;
  /** QueueItems flagged is_extra in active or already-played state */
  spent: number;
  /** earned − spent, never negative */
  available: number;
}

export function effectiveSongLimit(credits: SongCredits): number {
  return MAX_SONGS_PER_TABLE + credits.earned - credits.spent;
}

export function makeSongCredits(earned: number, spent: number): SongCredits {
  const safeEarned = Math.max(0, earned);
  const safeSpent = Math.max(0, spent);
  return {
    earned: safeEarned,
    spent: safeSpent,
    available: Math.max(0, safeEarned - safeSpent),
  };
}

/** Maximum song duration in seconds (10 minutes) */
export const MAX_SONG_DURATION_SECONDS = 600;

/** Reference amount for scoreboard progress bar (COP) */
export const SCOREBOARD_MAX_CONSUMPTION = 120_000;

/** Priority score factor: total_consumption / this value */
export const PRIORITY_SCORE_DIVISOR = 1_000;

// ─── Fairness Algorithm Constants ─────────���──────────────────────────────────

/** Points per minute since the table last had a song played */
export const WAIT_SCORE_PER_MINUTE = 2;

/** Bonus points if the table placed an order in the last 15 minutes */
export const RECENT_ORDER_BONUS = 8;

/** Minutes within which an order is considered "recent" */
export const RECENT_ORDER_WINDOW_MINUTES = 15;

/** Number of songs that must play before the same table can be at the top again */
export const COOLDOWN_SLOTS = 2;

/** Penalty applied when a table is in cooldown */
export const COOLDOWN_PENALTY = 100;

/** Number of recent played songs to check for dominance */
export const DOMINANCE_WINDOW = 5;

/** Penalty per song a table has in the recent dominance window */
export const DOMINANCE_PENALTY_PER_SONG = 25;

/** Penalty per active (pending/playing) queue item a table already has */
export const QUEUE_LOAD_PENALTY = 15;
