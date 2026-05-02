import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, QueueStatus, TableStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { CreateQueueItemDto } from "./dto/create-queue-item.dto";
import {
  MAX_SONG_DURATION_SECONDS,
  MAX_SONGS_PER_TABLE,
  EXTRA_SONG_CONSUMPTION_THRESHOLD,
  makeSongCredits,
  type SongCredits,
} from "@coffee-bar/shared";
import { PlaybackService } from "../playback/playback.service";
import { FairnessService } from "./fairness.service";
import { HousePlaylistService } from "../house-playlist/house-playlist.service";

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
    private readonly fairnessService: FairnessService,
    private readonly housePlaylist: HousePlaylistService,
  ) {}

  async findGlobal() {
    // House items are hidden from the public queue when pending — the bar's
    // fallback playlist should not feel like a "what's coming up" list to
    // the customers. The currently-playing item IS shown regardless of
    // source, so the customer can see what's on the speakers right now.
    const items = await this.prisma.queueItem.findMany({
      where: {
        OR: [
          { status: QueueStatus.playing },
          { status: QueueStatus.pending, source: "customer" },
        ],
      },
      include: queueInclude,
      orderBy: [{ position: "asc" }],
    });

    return items.map((item) => this.serializeQueueItem(item));
  }

  async findByTable(
    tableId: number,
    includeHistory = false,
    since?: Date,
  ) {
    // Optional `since` filter trims results to items created on/after that
    // timestamp. The customer view passes its session.opened_at so the
    // queue never leaks rows from a previous occupant of the same table.
    const sinceWhere = since ? { created_at: { gte: since } } : {};
    if (!includeHistory) {
      const items = await this.prisma.queueItem.findMany({
        where: {
          table_id: tableId,
          status: { in: [QueueStatus.pending, QueueStatus.playing] },
          ...sinceWhere,
        },
        include: queueInclude,
        orderBy: [{ position: "asc" }],
      });
      return items.map((item) => this.serializeQueueItem(item));
    }

    // Include active + recent history (played/skipped, last 10)
    const [active, history] = await Promise.all([
      this.prisma.queueItem.findMany({
        where: {
          table_id: tableId,
          status: { in: [QueueStatus.pending, QueueStatus.playing] },
          ...sinceWhere,
        },
        include: queueInclude,
        orderBy: [{ position: "asc" }],
      }),
      this.prisma.queueItem.findMany({
        where: {
          table_id: tableId,
          status: { in: [QueueStatus.played, QueueStatus.skipped] },
          ...sinceWhere,
        },
        include: queueInclude,
        orderBy: [{ updated_at: "desc" }],
        take: 10,
      }),
    ]);

    return [...active, ...history].map((item) => this.serializeQueueItem(item));
  }

  async getStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [played, skipped, pending, totalSongs] = await Promise.all([
      this.prisma.queueItem.count({
        where: { status: QueueStatus.played, updated_at: { gte: todayStart } },
      }),
      this.prisma.queueItem.count({
        where: { status: QueueStatus.skipped, updated_at: { gte: todayStart } },
      }),
      this.prisma.queueItem.count({
        where: { status: QueueStatus.pending },
      }),
      this.prisma.queueItem.count({
        where: { updated_at: { gte: todayStart } },
      }),
    ]);

    // Top table by songs played today
    const topTable = await this.prisma.queueItem.groupBy({
      by: ["table_id"],
      where: { status: QueueStatus.played, updated_at: { gte: todayStart } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 1,
    });

    // Average wait time (queued_at → started_playing_at) for today's played songs
    const playedWithTimes = await this.prisma.queueItem.findMany({
      where: {
        status: QueueStatus.played,
        updated_at: { gte: todayStart },
        started_playing_at: { not: null },
      },
      select: { queued_at: true, started_playing_at: true },
      take: 50, // Limit to avoid outlier skew
      orderBy: { updated_at: "desc" },
    });

    let avg_wait_seconds: number | null = null;
    if (playedWithTimes.length > 0) {
      const totalWait = playedWithTimes.reduce((sum, item) => {
        const wait =
          (item.started_playing_at!.getTime() - item.queued_at.getTime()) / 1000;
        return sum + Math.max(0, wait);
      }, 0);
      avg_wait_seconds = Math.round(totalWait / playedWithTimes.length);
    }

    // Tables participating today (only played/skipped, not just pending)
    const tablesParticipating = await this.prisma.queueItem.findMany({
      where: {
        updated_at: { gte: todayStart },
        status: { in: [QueueStatus.played, QueueStatus.skipped] },
      },
      select: { table_id: true },
      distinct: ["table_id"],
    });

    // Average playback duration (started_playing_at → finished_at|skipped_at)
    const withPlaybackTimes = await this.prisma.queueItem.findMany({
      where: {
        updated_at: { gte: todayStart },
        started_playing_at: { not: null },
        OR: [
          { finished_at: { not: null } },
          { skipped_at: { not: null } },
        ],
      },
      select: { started_playing_at: true, finished_at: true, skipped_at: true },
      take: 50,
      orderBy: { updated_at: "desc" },
    });

    let avg_play_duration_seconds: number | null = null;
    if (withPlaybackTimes.length > 0) {
      let validCount = 0;
      const totalDuration = withPlaybackTimes.reduce((sum, item) => {
        const end = item.finished_at ?? item.skipped_at;
        if (!end || !item.started_playing_at) return sum;
        const dur = (end.getTime() - item.started_playing_at.getTime()) / 1000;
        if (dur <= 0) return sum;
        validCount++;
        return sum + dur;
      }, 0);
      if (validCount > 0) {
        avg_play_duration_seconds = Math.round(totalDuration / validCount);
      }
    }

    return {
      songs_played_today: played,
      songs_skipped_today: skipped,
      songs_pending: pending,
      total_songs_today: totalSongs,
      avg_wait_seconds,
      avg_play_duration_seconds,
      tables_participating: tablesParticipating.length,
      top_table: topTable[0]
        ? { table_id: topTable[0].table_id, count: topTable[0]._count.id }
        : null,
    };
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

    if (table.status !== TableStatus.occupied) {
      throw new BadRequestException({
        message: "Table must be occupied to add songs to the queue",
        code: "TABLE_NOT_ACTIVE",
      });
    }

    // Validate duration
    if (duration <= 0) {
      throw new BadRequestException({
        message: "Song duration must be greater than 0",
        code: "SONG_INVALID_DURATION",
      });
    }
    if (duration > MAX_SONG_DURATION_SECONDS) {
      throw new BadRequestException({
        message: `Song duration exceeds maximum of ${MAX_SONG_DURATION_SECONDS} seconds (${Math.floor(MAX_SONG_DURATION_SECONDS / 60)} minutes)`,
        code: "SONG_TOO_LONG",
      });
    }

    // Per-table song limit:
    //   - 5 songs free.
    //   - Each additional song requires one "song credit", earned by a
    //     SINGLE delivered order >= EXTRA_SONG_CONSUMPTION_THRESHOLD in
    //     the current open session. Two small orders that add up to the
    //     threshold do NOT earn a credit.
    //   - When admin skips an extra song, the credit returns automatically
    //     (the spent-count excludes `skipped`).
    const activeSongsCount = await this.prisma.queueItem.count({
      where: {
        table_id,
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
      },
    });

    let willBeExtra = false;
    if (activeSongsCount >= MAX_SONGS_PER_TABLE) {
      const credits = await this.computeSongCreditsForTable(table_id);
      if (credits.available <= 0) {
        throw new BadRequestException({
          message:
            `Ya tienes ${MAX_SONGS_PER_TABLE} canciones en cola. Haz un pedido de $${(
              EXTRA_SONG_CONSUMPTION_THRESHOLD / 1000
            ).toFixed(0)} mil o más para desbloquear otra.`,
          code: "QUEUE_LIMIT_REACHED",
        });
      }
      willBeExtra = true;
    }

    // Validate no duplicate: song not already pending/playing from any table
    const duplicateInQueue = await this.prisma.queueItem.findFirst({
      where: {
        status: { in: [QueueStatus.pending, QueueStatus.playing] },
        song: { youtube_id },
      },
    });
    if (duplicateInQueue) {
      throw new BadRequestException({
        message: "Esta canción ya está en la cola",
        code: "QUEUE_DUPLICATE",
      });
    }

    // Validate song hasn't been played recently (last 30 minutes)
    const recentlyPlayed = await this.prisma.queueItem.findFirst({
      where: {
        status: QueueStatus.played,
        song: { youtube_id },
        finished_at: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
    });
    if (recentlyPlayed) {
      throw new BadRequestException({
        message: "Esta canción sonó hace poco. Intenta con otra",
        code: "QUEUE_RECENTLY_PLAYED",
      });
    }

    const song = await this.findOrCreateSong({
      youtube_id,
      title,
      duration,
      table_id,
    });

    const queueItem = await this.prisma.$transaction(async (tx) => {
      // Build fairness context
      const ctx = await this.fairnessService.buildContext(tx);

      // Calculate score for the requesting table
      const score = this.fairnessService.calculatePriorityScore(
        table_id,
        this.toNumber(table.total_consumption),
        ctx,
      );

      // Get current pending items to determine insertion position
      const pendingItems = await tx.queueItem.findMany({
        where: { status: QueueStatus.pending },
        orderBy: { position: "asc" },
        select: { id: true, table_id: true, priority_score: true },
      });

      const pendingWithScores = pendingItems.map((item) => ({
        ...item,
        priority_score: Number(item.priority_score),
      }));

      // Find the playing item to know its table (for adjacency check)
      const playingItem = await tx.queueItem.findFirst({
        where: { status: QueueStatus.playing },
        select: { id: true, table_id: true },
      });

      // Find where to insert based on fairness
      const insertAt = this.fairnessService.findInsertionPosition(
        table_id,
        score.total,
        pendingWithScores,
        ctx,
        playingItem?.table_id ?? null,
      );

      // Guard against NaN scores breaking Prisma Decimal
      const safeScore = Number.isFinite(score.total) ? score.total : 0;

      // Temporary position — will be fixed below
      const item = await tx.queueItem.create({
        data: {
          song_id: song.id,
          table_id,
          priority_score: safeScore,
          status: QueueStatus.pending,
          position: 9999,
          is_extra: willBeExtra,
        },
        include: queueInclude,
      });

      // Reorder: splice the new item at the correct position
      const orderedIds = pendingWithScores.map((p) => p.id);
      orderedIds.splice(insertAt, 0, item.id);

      // Reassign positions: playing item stays at 1, pending starts at 2
      const startPos = playingItem ? 2 : 1;
      if (playingItem) {
        await tx.queueItem.update({
          where: { id: playingItem.id },
          data: { position: 1 },
        });
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.queueItem.update({
          where: { id: orderedIds[i] },
          data: { position: startPos + i },
        });
      }

      // Re-fetch with includes
      return tx.queueItem.findUniqueOrThrow({
        where: { id: item.id },
        include: queueInclude,
      });
    });

    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(queueItem);
  }

  async playNext() {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: { status: QueueStatus.played, finished_at: now, skipped_at: null },
      });

      await this.compactPositions(tx);

      const nextItem = await this.pickNextPlayable(tx);

      if (!nextItem) return null;

      const updatedItem = await tx.queueItem.update({
        where: { id: nextItem.id },
        data: { status: QueueStatus.playing, started_playing_at: now },
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
        data: {
          status: QueueStatus.skipped,
          skipped_at: new Date(),
          finished_at: null,
        },
        include: queueInclude,
      });

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
        data: {
          status: QueueStatus.played,
          finished_at: new Date(),
          skipped_at: null,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updated;
    });

    await this.playbackService.setPaused();
    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
  }

  /**
   * Atomic transition: finish current song and start next one.
   * Single transaction avoids race conditions from two separate calls.
   */
  async advanceToNext() {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark current playing as played
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: {
          status: QueueStatus.played,
          finished_at: now,
          skipped_at: null,
        },
      });

      await this.compactPositions(tx);

      // 2. Find and promote next pending item (customer first, then house)
      const nextItem = await this.pickNextPlayable(tx);

      if (!nextItem) return null;

      const updatedItem = await tx.queueItem.update({
        where: { id: nextItem.id },
        data: { status: QueueStatus.playing, started_playing_at: now },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updatedItem;
    });

    // 3. Update playback state (buffering until frontend confirms playing)
    if (result) {
      await this.playbackService.setBuffering(result);
    } else {
      await this.playbackService.setIdle();
    }

    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
  }

  /**
   * Atomic: skip current playing song and start next one.
   * Single transaction — no partial state if one step fails.
   */
  async skipAndAdvance() {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark current playing as skipped
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: {
          status: QueueStatus.skipped,
          skipped_at: now,
          finished_at: null,
        },
      });

      await this.compactPositions(tx);

      // 2. Find and promote next pending item (customer first, then house)
      const nextItem = await this.pickNextPlayable(tx);

      if (!nextItem) return null;

      const updatedItem = await tx.queueItem.update({
        where: { id: nextItem.id },
        data: {
          status: QueueStatus.playing,
          started_playing_at: now,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return updatedItem;
    });

    if (result) {
      await this.playbackService.setBuffering(result);
    } else {
      await this.playbackService.setIdle();
    }

    await this.broadcastQueueUpdate();

    return result ? this.serializeQueueItem(result) : null;
  }

  /**
   * Admin: add song to queue without any restrictions.
   * No duration limit, no max songs, no duplicate check, no table validation.
   * Optionally specify position (default: next in queue).
   */
  async adminCreate(input: {
    youtube_id: string;
    title: string;
    duration: number;
    table_id?: number;
    position?: number;
  }) {
    const tableId = input.table_id ?? null;

    const song = await this.findOrCreateSong({
      youtube_id: input.youtube_id,
      title: input.title,
      duration: input.duration,
      table_id: tableId,
    });

    const queueItem = await this.prisma.$transaction(async (tx) => {
      // Get target position
      const targetPosition = input.position ?? null;

      if (targetPosition) {
        // Shift existing items at and after target position
        await tx.queueItem.updateMany({
          where: {
            status: { in: [QueueStatus.pending, QueueStatus.playing] },
            position: { gte: targetPosition },
          },
          data: { position: { increment: 1 } },
        });
      }

      const maxPos = await tx.queueItem.aggregate({
        where: { status: { in: [QueueStatus.pending, QueueStatus.playing] } },
        _max: { position: true },
      });

      const item = await tx.queueItem.create({
        data: {
          song_id: song.id,
          table_id: tableId,
          priority_score: 9999,
          status: QueueStatus.pending,
          position: targetPosition ?? (maxPos._max.position ?? 0) + 1,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return tx.queueItem.findUniqueOrThrow({
        where: { id: item.id },
        include: queueInclude,
      });
    });

    await this.broadcastQueueUpdate();
    return this.serializeQueueItem(queueItem);
  }

  /**
   * Admin: interrupt current playback and play this song immediately.
   * Finishes (or skips) the current song, inserts the new one, and starts it.
   */
  async adminPlayNow(input: {
    youtube_id: string;
    title: string;
    duration: number;
  }) {
    const song = await this.findOrCreateSong({
      youtube_id: input.youtube_id,
      title: input.title,
      duration: input.duration,
      table_id: null,
    });

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Finish current playing song
      await tx.queueItem.updateMany({
        where: { status: QueueStatus.playing },
        data: {
          status: QueueStatus.played,
          finished_at: now,
          skipped_at: null,
        },
      });

      // 2. Shift all pending items by 1
      await tx.queueItem.updateMany({
        where: {
          status: QueueStatus.pending,
        },
        data: { position: { increment: 1 } },
      });

      // 3. Create new item at position 1 as playing
      const item = await tx.queueItem.create({
        data: {
          song_id: song.id,
          table_id: null,
          priority_score: 9999,
          status: QueueStatus.playing,
          position: 1,
          started_playing_at: now,
        },
        include: queueInclude,
      });

      await this.compactPositions(tx);

      return item;
    });

    await this.playbackService.setBuffering(result);
    await this.broadcastQueueUpdate();

    return this.serializeQueueItem(result);
  }

  /**
   * Song credits earned/spent in the table's CURRENT open session.
   *
   *   earned = delivered orders (this session) whose subtotal >= threshold
   *   spent  = QueueItems flagged is_extra in pending/playing/played state
   *            (excludes `skipped` so admin-skipped extras refund the credit)
   *
   * Returned via `effectiveSongLimit` to the customer + projection snapshot
   * so the UI never disables the button while the server would still allow
   * the request.
   *
   * If the table has no open session, returns zero credits.
   */
  async computeSongCreditsForTable(tableId: number): Promise<SongCredits> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { current_session_id: true },
    });
    if (!table?.current_session_id) {
      return makeSongCredits(0, 0);
    }
    const session = await this.prisma.tableSession.findUnique({
      where: { id: table.current_session_id },
      select: { id: true, opened_at: true },
    });
    if (!session) {
      return makeSongCredits(0, 0);
    }

    // Earned credits: delivered orders this session with subtotal >= threshold.
    // Subtotal = sum(unit_price * quantity) over order_items.
    const deliveredOrders = await this.prisma.order.findMany({
      where: {
        table_session_id: session.id,
        status: "delivered",
      },
      select: {
        order_items: {
          select: { unit_price: true, quantity: true },
        },
      },
    });
    let earned = 0;
    for (const order of deliveredOrders) {
      const subtotal = order.order_items.reduce(
        (acc, it) => acc + this.toNumber(it.unit_price) * it.quantity,
        0,
      );
      if (subtotal >= EXTRA_SONG_CONSUMPTION_THRESHOLD) earned += 1;
    }

    // Spent credits: queue items flagged is_extra, scoped to this session
    // by created_at >= opened_at. Skipped items are excluded so admin-skip
    // returns the credit.
    const spent = await this.prisma.queueItem.count({
      where: {
        table_id: tableId,
        is_extra: true,
        created_at: { gte: session.opened_at },
        status: {
          in: [QueueStatus.pending, QueueStatus.playing, QueueStatus.played],
        },
      },
    });

    return makeSongCredits(earned, spent);
  }

  private serializeQueueItem(item: QueueRecord) {
    return {
      ...item,
      priority_score: this.toNumber(item.priority_score),
      table: item.table
        ? {
            ...item.table,
            total_consumption: this.toNumber(item.table.total_consumption),
          }
        : null,
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

  /**
   * Picks the next pending QueueItem to promote to `playing`. Customer
   * songs always win (priority over house). When there's no pending
   * customer queue item AND no pending house queue item, the bar falls
   * back to the curated house playlist: we synthesize a `Song` row for the
   * picked HousePlaylistItem (idempotent on youtube_id) and create a
   * QueueItem with source='house', table_id=null, priority_score=0.
   *
   * Returns the QueueItem ready to be marked playing, or null when even
   * the house playlist has no active items (truly silent bar).
   */
  private async pickNextPlayable(
    tx: Prisma.TransactionClient,
  ): Promise<QueueRecord | null> {
    // 1. Customer-first
    const customerNext = await tx.queueItem.findFirst({
      where: {
        status: QueueStatus.pending,
        source: "customer",
      },
      include: queueInclude,
      orderBy: { position: "asc" },
    });
    if (customerNext) return customerNext;

    // 2. House-pending (already loaded earlier, never started)
    const houseNext = await tx.queueItem.findFirst({
      where: {
        status: QueueStatus.pending,
        source: "house",
      },
      include: queueInclude,
      orderBy: { position: "asc" },
    });
    if (houseNext) return houseNext;

    // 3. Pull a fresh house song from the curated playlist.
    const houseItem = await this.housePlaylist.pickNextHouseSong();
    if (!houseItem) return null;

    // Reuse the Song row if we've ingested this youtube_id before; else
    // create one. House items are not bound to a table.
    const song = await this.findOrCreateSong({
      youtube_id: houseItem.youtube_id,
      title: houseItem.title,
      duration: houseItem.duration,
      table_id: null,
    });

    // Find the highest current position so we slot in at the end. We
    // compactPositions later anyway, but starting from the tail keeps
    // the create from clashing with active items.
    const last = await tx.queueItem.findFirst({
      where: { status: { in: [QueueStatus.playing, QueueStatus.pending] } },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const created = await tx.queueItem.create({
      data: {
        song_id: song.id,
        table_id: null,
        priority_score: 0,
        status: QueueStatus.pending,
        position: (last?.position ?? 0) + 1,
        source: "house",
        is_extra: false,
      },
      include: queueInclude,
    });

    // Stamp last_played_at on the playlist item so the rotation moves on.
    // Stamping at promote-time (not finish-time) means a skipped house
    // song still rotates — better than hammering the same song forever
    // if it gets repeatedly skipped for any reason.
    await this.housePlaylist.stampPlayed(houseItem.id);

    return created;
  }

  private async broadcastQueueUpdate() {
    const queue = await this.findGlobal();
    this.realtimeGateway.emitQueueUpdated(queue);
  }

  private async findOrCreateSong(input: {
    youtube_id: string;
    title: string;
    duration: number;
    table_id: number | null;
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
