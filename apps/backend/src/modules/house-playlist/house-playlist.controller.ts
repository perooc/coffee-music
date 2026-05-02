import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { HousePlaylistService } from "./house-playlist.service";

/**
 * Admin surface for the bar's fallback playlist. Lives behind admin auth
 * because customers should never see (or edit) this catalogue.
 *
 * Routes:
 *   GET    /house-playlist                 — list all
 *   GET    /house-playlist/validate?url=…  — live YouTube validation
 *   POST   /house-playlist                 — add (server re-validates)
 *   PATCH  /house-playlist/:id             — toggle active / rename / reorder
 *   DELETE /house-playlist/:id
 */
@Controller("house-playlist")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class HousePlaylistController {
  constructor(private readonly service: HousePlaylistService) {}

  @Get()
  list() {
    return this.service.findAll();
  }

  /**
   * Live validation endpoint. The frontend hits this when the admin pastes
   * a URL so we can show a preview (title + duration + thumbnail) before
   * saving. Accepts any of the URL forms our extractor knows.
   */
  @Get("validate")
  async validate(@Query("url") url: string) {
    const id = HousePlaylistService.extractYoutubeId(url ?? "");
    if (!id) {
      return {
        valid: false,
        reason: "URL o ID de YouTube no válido",
        code: "HOUSE_PLAYLIST_INVALID_URL",
      } as const;
    }
    try {
      const meta = await this.service.validateYoutubeId(id);
      return { valid: true as const, ...meta };
    } catch (e) {
      // Surface the structured response so the UI can show a friendly
      // hint without parsing exception strings.
      const resp = (e as { response?: { message?: string; code?: string } })
        ?.response;
      return {
        valid: false as const,
        reason: resp?.message ?? "No se pudo validar la canción",
        code: resp?.code ?? "HOUSE_PLAYLIST_VALIDATION_FAILED",
      };
    }
  }

  @Post()
  async create(
    @Body()
    body: { url: string },
  ) {
    const id = HousePlaylistService.extractYoutubeId(body.url ?? "");
    if (!id) {
      return {
        ok: false,
        code: "HOUSE_PLAYLIST_INVALID_URL",
        message: "URL o ID de YouTube no válido",
      };
    }
    // Re-validate server-side regardless of what the UI sent — never trust
    // a title / duration that the admin could have hand-edited in devtools.
    const meta = await this.service.validateYoutubeId(id);
    const created = await this.service.create({
      youtube_id: meta.youtube_id,
      title: meta.title,
      artist: meta.artist,
      duration: meta.duration,
    });
    return { ok: true, item: created };
  }

  @Patch(":id")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body()
    body: Partial<{ is_active: boolean; sort_order: number; title: string }>,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
