import { Body, Controller, Get, Param, ParseIntPipe, Patch } from "@nestjs/common";
import { TablesService } from "./tables.service";
import { UpdateTableDto } from "./dto/update-table.dto";

@Controller("tables")
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
