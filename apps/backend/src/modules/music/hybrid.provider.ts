import { Logger } from "@nestjs/common";
import type { MusicSearchProvider, MusicSearchResult } from "./music-search.provider";
import { SearchCache } from "./search-cache";
import { QuotaBudget } from "./quota-budget";

type ProviderResult =
  | { ok: true; results: MusicSearchResult[] }
  | { ok: false; error: string };

/**
 * One YouTube-API instance with its own quota budget. The hybrid provider
 * holds a list of these and walks them in order: when the first one's
 * soft budget is exhausted (or it 403s), it moves to the next without
 * waiting for the next-day reset. ytsr is always last.
 */
export interface YouTubeApiKeySlot {
  provider: MusicSearchProvider;
  budget: QuotaBudget;
}

/**
 * Hybrid music search provider with N-key fallback chain.
 *
 * Strategy:
 *   1. Cache first — respond from cache if query was searched recently.
 *   2. Walk the YouTube-API keys in order. For each key:
 *        - if the soft budget is exhausted → skip to next.
 *        - call the API. On success, cache + return.
 *        - on transient/quota error (403, 429, network) → skip to next.
 *   3. Last resort: ytsr (no key needed, scrapes YouTube directly).
 *   4. Every provider failed with an error → throw SEARCH_UNAVAILABLE.
 *   5. Every provider returned empty legitimately → [] (cached).
 *
 * Config via environment:
 *   - YOUTUBE_API_KEY        first key (primary).
 *   - YOUTUBE_API_KEY_2      second key (mid fallback). Optional.
 *   - YOUTUBE_API_KEY_3 ...  additional keys, picked up if defined.
 *   - YOUTUBE_DAILY_BUDGET_SOFT_LIMIT (default 8000) — applies to EACH key.
 *   - SEARCH_CACHE_TTL_SECONDS (default 1800).
 */
export class HybridMusicProvider implements MusicSearchProvider {
  readonly name = "hybrid";
  private readonly logger = new Logger(HybridMusicProvider.name);
  private readonly cache: SearchCache;
  private readonly slots: YouTubeApiKeySlot[];

  constructor(
    youtubeApiSlots: YouTubeApiKeySlot[],
    private readonly ytsr: MusicSearchProvider,
  ) {
    const cacheTtl = parseInt(process.env.SEARCH_CACHE_TTL_SECONDS ?? "1800", 10);
    this.cache = new SearchCache(cacheTtl);
    this.slots = youtubeApiSlots;

    this.logger.log(
      `Hybrid provider initialized — cache TTL: ${cacheTtl}s, ` +
        `${this.slots.length} YouTube-API key(s), ` +
        `last-resort: ${this.ytsr.name}`,
    );

    // Prune cache every 5 minutes
    setInterval(() => this.cache.prune(), 5 * 60 * 1000);
  }

  async search(query: string, limit: number): Promise<MusicSearchResult[]> {
    // Step 1: Cache
    const cached = this.cache.get(query, limit);
    if (cached) {
      this.logSearch("cache", query, cached.length);
      return cached;
    }

    let anyHardError = false;
    let anyLegitimateEmpty = false;

    // Step 2: Walk the YouTube-API keys in order. Each key has its own
    // budget; when one runs out we move on instead of falling all the way
    // through to ytsr.
    for (const slot of this.slots) {
      if (!slot.budget.canAfford()) {
        this.logger.warn(
          `Skipping ${slot.provider.name}: daily soft budget exhausted`,
        );
        continue;
      }
      const result = await this.tryProvider(slot.provider, query, limit);
      if (result.ok && result.results.length > 0) {
        slot.budget.consume();
        this.cache.set(query, limit, result.results);
        this.logSearch(slot.provider.name, query, result.results.length);
        return result.results;
      }
      if (result.ok) {
        // Legitimate empty from this provider. Try the next key — its
        // index might surface a result the others missed. If everything
        // returns empty we'll cache [] at the end.
        anyLegitimateEmpty = true;
        slot.budget.consume();
        continue;
      }
      anyHardError = true;
      this.logger.warn(
        `Provider ${slot.provider.name} failed: ${result.error} — trying next key`,
      );
    }

    // Step 3: ytsr as last resort.
    const ytsrResult = await this.tryProvider(this.ytsr, query, limit);
    if (ytsrResult.ok && ytsrResult.results.length > 0) {
      this.cache.set(query, limit, ytsrResult.results);
      this.logSearch(`${this.ytsr.name} (fallback)`, query, ytsrResult.results.length);
      return ytsrResult.results;
    }
    if (ytsrResult.ok) {
      anyLegitimateEmpty = true;
    } else {
      anyHardError = true;
      this.logger.warn(
        `Provider ${this.ytsr.name} failed: ${ytsrResult.error}`,
      );
    }

    // Step 4: All providers came back. Distinguish hard error vs empty.
    if (!anyLegitimateEmpty && anyHardError) {
      this.logger.error(
        `Every search provider failed for "${query}". ` +
          `The customer/admin will see SEARCH_UNAVAILABLE.`,
      );
      throw new Error("SEARCH_UNAVAILABLE");
    }

    // At least one provider responded successfully with 0 results.
    // Cache so we don't retry.
    this.cache.set(query, limit, []);
    this.logSearch("empty (legitimate)", query, 0);
    return [];
  }

  private async tryProvider(
    provider: MusicSearchProvider,
    query: string,
    limit: number,
  ): Promise<ProviderResult> {
    try {
      const results = await provider.search(query, limit);
      return { ok: true, results };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Provider "${provider.name}" threw: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  private logSearch(source: string, query: string, count: number): void {
    this.logger.log(
      JSON.stringify({
        event: "hybrid_search",
        source,
        query,
        results_count: count,
        // Per-slot budget rollup for observability. Dashboards can split
        // this and alert when any single key crosses 90%.
        budgets: this.slots.map((s, i) => ({
          slot: i + 1,
          name: s.provider.name,
          used: s.budget.used,
          remaining: s.budget.remaining,
        })),
        cache_size: this.cache.size,
      }),
    );
  }
}
