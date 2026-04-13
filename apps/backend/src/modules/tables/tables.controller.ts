import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { TablesService } from "./tables.service";

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
}
