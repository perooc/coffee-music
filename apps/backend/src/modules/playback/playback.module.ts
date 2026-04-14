import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { PlaybackService } from "./playback.service";
import { PlaybackController } from "./playback.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [PlaybackController],
  providers: [PlaybackService],
  exports: [PlaybackService],
})
export class PlaybackModule {}
