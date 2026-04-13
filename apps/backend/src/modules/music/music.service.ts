import { Injectable, Logger } from "@nestjs/common";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ytsr = require("ytsr");

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);

  async search(query: string, limit = 10) {
    try {

      const results = await ytsr(query, {
        limit,
        safeSearch: false,
      });

      return results.items
        .filter((item: Record<string, unknown>) => item.type === "video")
        .map((item: Record<string, unknown>) => {
          const thumbnails = item.thumbnails as
            | { url: string | null }[]
            | undefined;
          const duration = item.duration as string | null;

          return {
            youtubeId: item.id as string,
            title: item.title as string,
            duration: duration ? this.parseDuration(duration) : 0,
            thumbnail: thumbnails?.[0]?.url ?? null,
          };
        })
        .filter((item: { duration: number }) => item.duration > 0);
    } catch (error) {
      this.logger.error("YouTube search failed", error);
      return [];
    }
  }

  private parseDuration(duration: string): number {
    const parts = duration.split(":").map(Number);

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] || 0;
  }
}
