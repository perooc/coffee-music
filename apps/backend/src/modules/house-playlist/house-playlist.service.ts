import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

export interface YouTubeVideoMeta {
  youtube_id: string;
  title: string;
  artist: string | null;
  duration: number;
  thumbnail: string | null;
}

@Injectable()
export class HousePlaylistService {
  private readonly logger = new Logger(HousePlaylistService.name);
  private readonly apiKey = process.env.YOUTUBE_API_KEY ?? "";

  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  findAll() {
    return this.prisma.housePlaylistItem.findMany({
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.housePlaylistItem.findUnique({
      where: { id },
    });
    if (!item) {
      throw new NotFoundException({
        message: `HousePlaylistItem ${id} not found`,
        code: "HOUSE_PLAYLIST_NOT_FOUND",
      });
    }
    return item;
  }

  async create(input: {
    youtube_id: string;
    title: string;
    artist?: string | null;
    duration: number;
  }) {
    if (!input.youtube_id || input.youtube_id.length !== 11) {
      throw new BadRequestException({
        message: "Invalid youtube_id (expected 11 characters)",
        code: "HOUSE_PLAYLIST_INVALID_ID",
      });
    }
    try {
      // Order new items at the bottom of the active set so the rotation
      // doesn't bump existing ones around.
      const last = await this.prisma.housePlaylistItem.findFirst({
        orderBy: { sort_order: "desc" },
        select: { sort_order: true },
      });
      return await this.prisma.housePlaylistItem.create({
        data: {
          youtube_id: input.youtube_id,
          title: input.title,
          artist: input.artist ?? null,
          duration: input.duration,
          sort_order: (last?.sort_order ?? 0) + 1,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new BadRequestException({
          message: "Esa canción ya está en la playlist base",
          code: "HOUSE_PLAYLIST_DUPLICATE",
        });
      }
      throw e;
    }
  }

  async update(
    id: number,
    patch: Partial<{ is_active: boolean; sort_order: number; title: string }>,
  ) {
    await this.findOne(id);
    return this.prisma.housePlaylistItem.update({
      where: { id },
      data: patch,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.housePlaylistItem.delete({ where: { id } });
    return { ok: true };
  }

  // ─── YouTube validation ───────────────────────────────────────────────────

  /**
   * Best-effort URL → youtube_id extractor. Accepts:
   *   - youtube.com/watch?v=ID
   *   - youtu.be/ID
   *   - youtube.com/embed/ID
   *   - youtube.com/shorts/ID  (rejected later by validate; shorts <60s)
   *   - bare 11-char ID
   *
   * Returns null when no plausible id is found.
   */
  static extractYoutubeId(input: string): string | null {
    const trimmed = (input ?? "").trim();
    if (!trimmed) return null;

    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * Hits /videos?id=X on the YouTube Data API to confirm the id exists,
   * is embeddable, and pulls the canonical title + duration.
   */
  async validateYoutubeId(youtubeId: string): Promise<YouTubeVideoMeta> {
    if (!youtubeId || !/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
      throw new BadRequestException({
        message: "URL o ID de YouTube no válido",
        code: "HOUSE_PLAYLIST_INVALID_URL",
      });
    }
    if (!this.apiKey) {
      throw new ServiceUnavailableException({
        message: "Validación de YouTube no disponible (API key no configurada)",
        code: "HOUSE_PLAYLIST_API_DISABLED",
      });
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("id", youtubeId);
    url.searchParams.set("key", this.apiKey);

    let res: Response;
    try {
      res = await fetch(url.toString());
    } catch (err) {
      this.logger.error(`fetch YouTube /videos failed: ${String(err)}`);
      throw new ServiceUnavailableException({
        message: "No se pudo validar la canción con YouTube",
        code: "HOUSE_PLAYLIST_UPSTREAM_ERROR",
      });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      this.logger.error(`YouTube /videos returned ${res.status}: ${body}`);
      if (res.status === 403) {
        throw new ServiceUnavailableException({
          message: "Cuota de YouTube agotada por hoy",
          code: "HOUSE_PLAYLIST_QUOTA_EXCEEDED",
        });
      }
      throw new ServiceUnavailableException({
        message: "YouTube respondió con un error",
        code: "HOUSE_PLAYLIST_UPSTREAM_ERROR",
      });
    }

    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          channelTitle?: string;
          thumbnails?: {
            default?: { url?: string };
            medium?: { url?: string };
          };
        };
        contentDetails?: { duration?: string };
        status?: { embeddable?: boolean; uploadStatus?: string };
      }>;
    };

    const item = data.items?.[0];
    if (!item) {
      throw new BadRequestException({
        message: "No encontramos esta canción en YouTube",
        code: "HOUSE_PLAYLIST_NOT_FOUND_REMOTE",
      });
    }
    if (item.status?.embeddable === false) {
      throw new BadRequestException({
        message: "Este video no permite incrustarse — usa otro",
        code: "HOUSE_PLAYLIST_NOT_EMBEDDABLE",
      });
    }
    const duration = parseIsoDuration(item.contentDetails?.duration ?? "");
    if (duration <= 0) {
      throw new BadRequestException({
        message: "No se pudo leer la duración del video",
        code: "HOUSE_PLAYLIST_NO_DURATION",
      });
    }

    return {
      youtube_id: item.id,
      title: item.snippet?.title ?? "Sin título",
      artist: item.snippet?.channelTitle ?? null,
      duration,
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        null,
    };
  }

  // ─── Fallback selection ───────────────────────────────────────────────────

  /**
   * Picks the next house song to play when the customer queue is empty.
   * Strategy: oldest `last_played_at` first (NULLs first → never played),
   * then by sort_order. Returns null if no active items exist.
   */
  async pickNextHouseSong() {
    return this.prisma.housePlaylistItem.findFirst({
      where: { is_active: true },
      orderBy: [
        { last_played_at: { sort: "asc", nulls: "first" } },
        { sort_order: "asc" },
        { id: "asc" },
      ],
    });
  }

  async stampPlayed(houseItemId: number) {
    await this.prisma.housePlaylistItem.update({
      where: { id: houseItemId },
      data: { last_played_at: new Date() },
    });
  }
}

function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + min * 60 + s;
}
