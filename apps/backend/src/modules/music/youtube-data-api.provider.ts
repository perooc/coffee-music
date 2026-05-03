import { Logger } from "@nestjs/common";
import type { MusicSearchProvider, MusicSearchResult } from "./music-search.provider";

/**
 * YouTube Data API v3 provider.
 *
 * Requires YOUTUBE_API_KEY environment variable.
 * Free tier: 10,000 units/day. Each search costs 100 units = ~100 searches/day.
 *
 * Flow:
 * 1. Search for videos with /search?type=video
 * 2. Get durations with /videos?part=contentDetails
 */
export class YouTubeDataApiProvider implements MusicSearchProvider {
  readonly name: string;
  private readonly logger = new Logger(YouTubeDataApiProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl = "https://www.googleapis.com/youtube/v3";

  /**
   * @param apiKey — explicit key. When omitted, falls back to
   *   `YOUTUBE_API_KEY` from the environment for back-compat.
   * @param label — appended to `provider.name` so logs and the hybrid
   *   metrics can tell instances apart when multiple keys are wired up.
   */
  constructor(apiKey?: string, label?: string) {
    const key = apiKey ?? process.env.YOUTUBE_API_KEY ?? "";
    if (!key) {
      this.logger.warn(
        "YouTube Data API provider has no key — search calls will return empty",
      );
    }
    this.apiKey = key;
    this.name = label ? `youtube-data-api(${label})` : "youtube-data-api";
  }

  async search(query: string, limit: number): Promise<MusicSearchResult[]> {
    if (!this.apiKey) {
      this.logger.warn("Skipping search: no API key configured");
      return [];
    }

    const start = Date.now();

    try {
      // Step 1: Search for videos
      const searchUrl = new URL(`${this.baseUrl}/search`);
      searchUrl.searchParams.set("part", "snippet");
      searchUrl.searchParams.set("type", "video");
      searchUrl.searchParams.set("videoCategoryId", "10"); // Music category
      searchUrl.searchParams.set("maxResults", String(limit));
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("key", this.apiKey);

      const searchRes = await fetch(searchUrl.toString());

      if (!searchRes.ok) {
        const errorBody = await searchRes.text();
        const status = searchRes.status;

        if (status === 403) {
          this.logger.error(
            `YouTube API quota exceeded or forbidden: ${errorBody}`,
          );
          throw new YouTubeApiError("QUOTA_EXCEEDED", "YouTube API quota exceeded");
        }
        if (status === 400) {
          this.logger.error(`YouTube API bad request: ${errorBody}`);
          throw new YouTubeApiError("INVALID_REQUEST", "Invalid search request");
        }

        this.logger.error(`YouTube API error ${status}: ${errorBody}`);
        throw new YouTubeApiError("UPSTREAM_ERROR", `YouTube API returned ${status}`);
      }

      const searchData = (await searchRes.json()) as {
        items?: {
          id: { videoId: string };
          snippet: { title: string; thumbnails: { default?: { url: string } } };
        }[];
      };

      const items = searchData.items ?? [];
      if (items.length === 0) {
        this.logger.log(
          `Search "${query}" returned 0 results (${Date.now() - start}ms)`,
        );
        return [];
      }

      // Step 2: Get durations via /videos
      const videoIds = items.map((item) => item.id.videoId).join(",");
      const videosUrl = new URL(`${this.baseUrl}/videos`);
      videosUrl.searchParams.set("part", "contentDetails");
      videosUrl.searchParams.set("id", videoIds);
      videosUrl.searchParams.set("key", this.apiKey);

      const videosRes = await fetch(videosUrl.toString());

      if (!videosRes.ok) {
        this.logger.error(
          `YouTube Videos API error ${videosRes.status}`,
        );
        // Return results without duration rather than failing entirely
        return items.map((item) => ({
          youtubeId: item.id.videoId,
          title: item.snippet.title,
          duration: 0,
          thumbnail: item.snippet.thumbnails.default?.url ?? null,
        }));
      }

      const videosData = (await videosRes.json()) as {
        items?: {
          id: string;
          contentDetails: { duration: string };
        }[];
      };

      const durationMap = new Map<string, number>();
      for (const v of videosData.items ?? []) {
        durationMap.set(v.id, this.parseIsoDuration(v.contentDetails.duration));
      }

      const results: MusicSearchResult[] = items
        .map((item) => ({
          youtubeId: item.id.videoId,
          title: item.snippet.title,
          duration: durationMap.get(item.id.videoId) ?? 0,
          thumbnail: item.snippet.thumbnails.default?.url ?? null,
        }))
        .filter((r) => r.duration > 0);

      const elapsed = Date.now() - start;
      this.logger.log(
        `Search "${query}" → ${results.length} results (${elapsed}ms)`,
      );

      return results;
    } catch (error) {
      if (error instanceof YouTubeApiError) throw error;

      const elapsed = Date.now() - start;
      this.logger.error(
        `YouTube Data API search failed (${elapsed}ms)`,
        error,
      );
      return [];
    }
  }

  /**
   * Parse ISO 8601 duration (PT4M13S, PT1H2M3S) to seconds.
   */
  private parseIsoDuration(iso: string): number {
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const seconds = parseInt(match[3] || "0", 10);
    return hours * 3600 + minutes * 60 + seconds;
  }
}

export class YouTubeApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}
