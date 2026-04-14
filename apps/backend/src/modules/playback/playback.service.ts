import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

type QueueRecord = Prisma.QueueItemGetPayload<{
  include: { song: true; table: true };
}>;

@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async setIdle() {
    const state = await this.prisma.playbackState.upsert({
      where: { id: 1 },
      update: {
        status: "idle",
        queue_item_id: null,
        started_at: null,
        position_seconds: null,
      },
      create: {
        id: 1,
        status: "idle",
      },
    });
    this.realtimeGateway.emitPlaybackUpdated(state);
    return state;
  }

  async setFromQueueItem(item: QueueRecord) {
    const startedAt = new Date();
    const state = await this.prisma.playbackState.upsert({
      where: { id: 1 },
      update: {
        status: "playing",
        queue_item_id: item.id,
        started_at: startedAt,
        position_seconds: 0,
      },
      create: {
        id: 1,
        status: "playing",
        queue_item_id: item.id,
        started_at: startedAt,
        position_seconds: 0,
      },
    });
    this.realtimeGateway.emitPlaybackUpdated(state);
    return state;
  }

  async getCurrent() {
    const state = await this.prisma.playbackState.findUnique({
      where: { id: 1 },
      include: {
        queue_item: {
          include: {
            song: true,
            table: true,
          },
        },
      },
    });

    if (!state) {
      return this.setIdle();
    }

    return state;
  }
}
