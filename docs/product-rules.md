# Product & Business Rules

## Queue Rules

| Rule | Value | Source |
|------|-------|--------|
| Max songs per table (pending + playing) | 2 | `MAX_SONGS_PER_TABLE` |
| Max song duration | 600 seconds (10 min) | `MAX_SONG_DURATION_SECONDS` |
| Duplicate policy | No same song pending twice per table | Queue service validation |
| Priority score | `total_consumption / 1000` | `PRIORITY_SCORE_DIVISOR` |
| Position assignment | `max(current positions) + 1` | Auto-increment |

## Queue Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Waiting to be played |
| `playing` | Currently playing |
| `played` | Finished |
| `skipped` | Skipped by admin |

## Order Rules

| Rule | Value |
|------|-------|
| Min items per order | 1 |
| Max quantity per item | 50 |
| Stock validation | Required — order fails if insufficient |
| Cancellation | Restores stock, subtracts from table consumption |

## Order Statuses

| Status | Meaning | Transitions to |
|--------|---------|---------------|
| `pending` | Just created | `preparing`, `cancelled` |
| `preparing` | In preparation | `ready`, `delivered` |
| `ready` | Ready for pickup | `delivered` |
| `delivered` | Delivered to table | — |
| `cancelled` | Cancelled (stock restored) | — |

## Table Statuses

| Status | Meaning |
|--------|---------|
| `available` | Free, no active session |
| `active` | In use, can order and queue songs |
| `occupied` | Reserved / in use but not active for orders |
| `inactive` | Disabled |

## Scoreboard

| Metric | Value | Source |
|--------|-------|--------|
| Progress bar max | COP 120,000 | `SCOREBOARD_MAX_CONSUMPTION` |

## Shared Constants Location

All constants live in `packages/shared/src/constants/`:
- `queue.ts` — `MAX_SONGS_PER_TABLE`, `MAX_SONG_DURATION_SECONDS`
- `business.ts` — `SCOREBOARD_MAX_CONSUMPTION`, `PRIORITY_SCORE_DIVISOR`
