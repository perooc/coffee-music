import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, QueueStatus, TableStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateQueueItemDto } from "./dto/create-queue-item.dto";

const queueInclude = {
  song: true,
  table: true,
} satisfies Prisma.QueueItemInclude;

type QueueRecord = Prisma.QueueItemGetPayload<{ include: typeof queueInclude }>;

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async findGlobal() {
    const items = await this.prisma.queueItem.findMany({
      include: queueInclude,
      orderBy: [{ position: "asc" }],
    });

    return items.map((item) => this.serializeQueueItem(item));
  }

  async findByTable(tableId: number) {
    const items = await this.prisma.queueItem.findMany({
      where: {
        table_id: tableId,
      },
      include: queueInclude,
      orderBy: [{ position: "asc" }],
    });

    return items.map((item) => this.serializeQueueItem(item));
  }

  async getCurrentPlaying() {
    const item = await this.prisma.queueItem.findFirst({
      where: {
        status: "playing",
      },
      include: queueInclude,
      orderBy: {
        position: "asc",
      },
    });

    return item ? this.serializeQueueItem(item) : null;
  }

  async create(createQueueItemDto: CreateQueueItemDto) {
    const { youtube_id, title, duration, table_id } = createQueueItemDto;

    const table = await this.prisma.table.findUnique({
      where: {
        id: table_id,
      },
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${table_id} not found`);
    }

    if (table.status !== TableStatus.active) {
      throw new BadRequestException("Table must be active to add songs to the queue");
    }

    const maxPosition = await this.prisma.queueItem.aggregate({
      _max: {
        position: true,
      },
    });

    const song = await this.findOrCreateSong({
      youtube_id,
      title,
      duration,
      table_id,
    });

    const queueItem = await this.prisma.queueItem.create({
      data: {
        song_id: song.id,
        table_id,
        priority_score: 0,
        status: QueueStatus.pending,
        position: (maxPosition._max.position ?? 0) + 1,
      },
      include: queueInclude,
    });

    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(queueItem);
  }

  async playNext() {
    await this.prisma.queueItem.updateMany({
      where: {
        status: QueueStatus.playing,
      },
      data: {
        status: QueueStatus.played,
      },
    });

    const nextItem = await this.prisma.queueItem.findFirst({
      where: {
        status: QueueStatus.pending,
      },
      include: queueInclude,
      orderBy: {
        position: "asc",
      },
    });

    if (!nextItem) {
      return null;
    }

    const updatedItem = await this.prisma.queueItem.update({
      where: {
        id: nextItem.id,
      },
      data: {
        status: QueueStatus.playing,
      },
      include: queueInclude,
    });

    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(updatedItem);
  }

  async skip(id: number) {
    const queueItem = await this.prisma.queueItem.findUnique({
      where: {
        id,
      },
      include: queueInclude,
    });

    if (!queueItem) {
      throw new NotFoundException(`Queue item with ID ${id} not found`);
    }

    const updatedItem = await this.prisma.queueItem.update({
      where: {
        id,
      },
      data: {
        status: QueueStatus.skipped,
      },
      include: queueInclude,
    });

    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(updatedItem);
  }

  private serializeQueueItem(item: QueueRecord) {
    return {
      ...item,
      priority_score: this.toNumber(item.priority_score),
      table: {
        ...item.table,
        total_consumption: this.toNumber(item.table.total_consumption),
      },
    };
  }

  private toNumber(value: Prisma.Decimal | number) {
    return Number(value);
  }

  private async broadcastQueueUpdate() {
    const queue = await this.findGlobal();
    this.realtimeGateway.emitQueueUpdated(queue);
  }

  private async findOrCreateSong(input: {
    youtube_id: string;
    title: string;
    duration: number;
    table_id: number;
  }) {
    const existingSong = await this.prisma.song.findUnique({
      where: {
        youtube_id: input.youtube_id,
      },
    });

    if (existingSong) {
      return existingSong;
    }

    return this.prisma.song.create({
      data: {
        youtube_id: input.youtube_id,
        title: input.title,
        duration: input.duration,
        requested_by_table: input.table_id,
      },
    });
  }
}
