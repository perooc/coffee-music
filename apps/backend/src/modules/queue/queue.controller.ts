import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CreateQueueItemDto } from "./dto/create-queue-item.dto";
import { QueueService } from "./queue.service";

@Controller("queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get("global")
  findGlobal() {
    return this.queueService.findGlobal();
  }

  @Get()
  findByTable(@Query("table_id", ParseIntPipe) tableId: number) {
    return this.queueService.findByTable(tableId);
  }

  @Get("current")
  getCurrentPlaying() {
    return this.queueService.getCurrentPlaying();
  }

  @Post()
  create(@Body() createQueueItemDto: CreateQueueItemDto) {
    return this.queueService.create(createQueueItemDto);
  }

  @Post("play-next")
  playNext() {
    return this.queueService.playNext();
  }

  @Post("finish-current")
  finishCurrent() {
    return this.queueService.finishCurrent();
  }

  @Patch(":id/skip")
  skip(@Param("id", ParseIntPipe) id: number) {
    return this.queueService.skip(id);
  }
}
