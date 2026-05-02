import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { PlaybackModule } from "../playback/playback.module";
import { HousePlaylistModule } from "../house-playlist/house-playlist.module";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";
import { FairnessService } from "./fairness.service";

@Module({
  imports: [RealtimeModule, PlaybackModule, HousePlaylistModule],
  controllers: [QueueController],
  providers: [QueueService, FairnessService],
})
export class QueueModule {}
