import { Controller, Get } from "@nestjs/common";
import { PlaybackService } from "./playback.service";

@Controller("playback")
export class PlaybackController {
  constructor(private readonly playbackService: PlaybackService) {}

  @Get("current")
  getCurrent() {
    return this.playbackService.getCurrent();
  }
}
