import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, QueueStatus, TableStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateQueueItemDto } from "./dto/create-queue-item.dto";
import { MAX_SONGS_PER_TABLE, MAX_SONG_DURATION_SECONDS } from "@coffee-bar/shared";
import { PlaybackService } from "../playback/playback.service";

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
    private readonly playbackService: PlaybackService,
  ) {}

  async findGlobal() {
    const items = await this.prisma.queueItem.findMany({
      where: {
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
      },
      include: queueInclude,
      orderBy: [{ position: "asc" }],
    });

    return items.map((item) => this.serializeQueueItem(item));
  }

  async findByTable(tableId: number) {
    const items = await this.prisma.queueItem.findMany({
      where: {
        table_id: tableId,
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
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

    // Validate duration
    if (duration <= 0) {
      throw new BadRequestException("Song duration must be greater than 0");
    }
    if (duration > MAX_SONG_DURATION_SECONDS) {
      throw new BadRequestException(
        `Song duration exceeds maximum of ${MAX_SONG_DURATION_SECONDS} seconds (${Math.floor(MAX_SONG_DURATION_SECONDS / 60)} minutes)`,
      );
    }

    // Validate max songs per table
    const activeSongsCount = await this.prisma.queueItem.count({
      where: {
        table_id,
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
      },
    });
    if (activeSongsCount >= MAX_SONGS_PER_TABLE) {
      throw new BadRequestException(
        `Table already has ${MAX_SONGS_PER_TABLE} songs in queue`,
      );
    }

    // Validate no duplicate pending song by same table
    const duplicatePending = await this.prisma.queueItem.findFirst({
      where: {
        table_id,
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
        song: { youtube_id },
      },
    });
    if (duplicatePending) {
      throw new BadRequestException("This song is already in your queue");
    }

    const song = await this.findOrCreateSong({
      youtube_id,
      title,
      duration,
      table_id,
    });

    const queueItem = await this.prisma.$transaction(async (tx) => {
      const maxPosition = await tx.queueItem.aggregate({
        where: {
          status: { in: [QueueStatus.pending, QueueStatus.playing] },
        },
        _max: { position: true },
      });

      const item = await tx.queueItem.create({
        data: {
          song_id: song.id,
          table_id,
          priority_score: 0,
          status: QueueStatus.pending,
          position: (maxPosition._max.position ?? 0) + 1,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return item;
    });

    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(queueItem);
  }

  async playNext() {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: { status: QueueStatus.played },
      });

      await this.compactPositions(tx);

      const nextItem = await tx.queueItem.findFirst({
        where: { status: QueueStatus.pending },
        include: queueInclude,
        orderBy: { position: "asc" },
      });

      if (!nextItem) return null;

      const updatedItem = await tx.queueItem.update({
        where: { id: nextItem.id },
        data: { status: QueueStatus.playing },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updatedItem;
    });

    if (result) {
      await this.playbackService.setFromQueueItem(result);
    } else {
      await this.playbackService.setIdle();
    }

    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
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

    const updatedItem = await this.prisma.$transaction(async (tx) => {
      const item = await tx.queueItem.update({
        where: { id },
        data: { status: QueueStatus.skipped },
        include: queueInclude,
      });

      // Compact positions of remaining pending items
      await this.compactPositions(tx);

      return item;
    });

    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(updatedItem);
  }

  async finishCurrent() {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.queueItem.findFirst({
        where: { status: QueueStatus.playing },
        include: queueInclude,
        orderBy: { position: "asc" },
      });

      if (!current) return null;

      const updated = await tx.queueItem.update({
        where: { id: current.id },
        data: { status: QueueStatus.played },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updated;
    });

    await this.playbackService.setIdle();
    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
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

  private async compactPositions(tx: Prisma.TransactionClient) {
    const activeItems = await tx.queueItem.findMany({
      where: { status: { in: [QueueStatus.playing, QueueStatus.pending] } },
      orderBy: { position: "asc" },
      select: { id: true },
    });

    for (let i = 0; i < activeItems.length; i++) {
      await tx.queueItem.update({
        where: { id: activeItems[i].id },
        data: { position: i + 1 },
      });
    }
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
