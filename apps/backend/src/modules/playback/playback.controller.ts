import { Body, Controller, Get, Patch } from "@nestjs/common";
import { PlaybackService } from "./playback.service";

/**
 * Playback endpoints are used by the in-house TV player, which runs
 * unattended without a user login. They are intentionally public in G3.
 *
 * TODO(G-later): introduce a `player_token` (long-lived, narrow scope)
 * and guard the PATCH endpoints. GET `/playback/current` can remain open.
 */
@Controller("playback")
export class PlaybackController {
  constructor(private readonly playbackService: PlaybackService) {}

  @Get("current")
  getCurrent() {
    return this.playbackService.getCurrent();
  }

  @Patch("playing")
  setPlaying() {
    return this.playbackService.setPlaying();
  }

  @Patch("progress")
  updateProgress(@Body() body: { position_seconds: number }) {
    return this.playbackService.updateProgress(body.position_seconds);
  }
}
