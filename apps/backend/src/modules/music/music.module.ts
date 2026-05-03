import { Logger, Module } from "@nestjs/common";
import { MusicController } from "./music.controller";
import { MusicService } from "./music.service";
import { MUSIC_SEARCH_PROVIDER } from "./music-search.provider";
import { YtsrProvider } from "./ytsr.provider";
import { YouTubeDataApiProvider } from "./youtube-data-api.provider";
import { HybridMusicProvider, type YouTubeApiKeySlot } from "./hybrid.provider";
import { QuotaBudget } from "./quota-budget";

const logger = new Logger("MusicModule");

/**
 * Discover all configured YouTube API keys from env, in order of fallback.
 *   YOUTUBE_API_KEY     → primary
 *   YOUTUBE_API_KEY_2   → mid fallback (when key 1 is exhausted)
 *   YOUTUBE_API_KEY_3   → tertiary (rare; supported for completeness)
 *   …
 *
 * Empty entries are skipped silently. The legacy single-key configuration
 * (only YOUTUBE_API_KEY set) keeps working unchanged.
 */
function readApiKeys(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const primary = process.env.YOUTUBE_API_KEY;
  if (primary) out.push({ key: primary, label: "1" });
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`YOUTUBE_API_KEY_${i}`];
    if (k) out.push({ key: k, label: String(i) });
  }
  return out;
}

/**
 * Provider selection:
 *   - At least one YOUTUBE_API_KEY* set → hybrid (cache + N keys + ytsr).
 *   - None set → ytsr only.
 */
@Module({
  controllers: [MusicController],
  providers: [
    MusicService,
    {
      provide: MUSIC_SEARCH_PROVIDER,
      useFactory: () => {
        const keys = readApiKeys();
        const budgetLimit = parseInt(
          process.env.YOUTUBE_DAILY_BUDGET_SOFT_LIMIT ?? "8000",
          10,
        );
        if (keys.length === 0) {
          logger.log("Using ytsr provider (no YOUTUBE_API_KEY* set)");
          return new YtsrProvider();
        }
        const slots: YouTubeApiKeySlot[] = keys.map((k) => ({
          provider: new YouTubeDataApiProvider(k.key, k.label),
          budget: new QuotaBudget(budgetLimit),
        }));
        logger.log(
          `Using hybrid provider — ${keys.length} YouTube API key(s) + ytsr fallback + cache`,
        );
        return new HybridMusicProvider(slots, new YtsrProvider());
      },
    },
  ],
})
export class MusicModule {}
