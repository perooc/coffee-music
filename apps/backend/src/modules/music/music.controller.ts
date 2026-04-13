import { Controller, Get, Query, BadRequestException } from "@nestjs/common";
import { MusicService } from "./music.service";

@Controller("music")
export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  @Get("search")
  async search(@Query("q") query: string) {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException("Query parameter 'q' is required");
    }

    if (query.trim().length < 2) {
      throw new BadRequestException("Query must be at least 2 characters");
    }

    return this.musicService.search(query.trim());
  }
}
