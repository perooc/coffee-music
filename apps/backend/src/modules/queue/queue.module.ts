import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { PlaybackModule } from "../playback/playback.module";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";

@Module({
  imports: [RealtimeModule, PlaybackModule],
  controllers: [QueueController],
  providers: [QueueService],
})
export class QueueModule {}
