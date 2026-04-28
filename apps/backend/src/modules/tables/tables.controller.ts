import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { TablesService } from "./tables.service";
import { UpdateTableDto } from "./dto/update-table.dto";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";

/**
 * Tables surface = staff only. Customers do not need to list tables; they
 * arrive at /mesa/:id via the QR and read their own table/session there.
 * Every endpoint requires an admin token.
 */
@Controller("tables")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  findAll() {
    return this.tablesService.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.tablesService.findOne(id);
  }

  @Get(":id/detail")
  findOneDetailed(@Param("id", ParseIntPipe) id: number) {
    return this.tablesService.findOneDetailed(id);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id", ParseIntPipe) id: number,
    @Body() updateTableDto: UpdateTableDto,
  ) {
    return this.tablesService.updateStatus(id, updateTableDto);
  }
}
