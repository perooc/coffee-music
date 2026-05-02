import { Module } from "@nestjs/common";
import { TablesController } from "./tables.controller";
import { PublicTablesController } from "./public-tables.controller";
import { TablesService } from "./tables.service";

@Module({
  controllers: [TablesController, PublicTablesController],
  providers: [TablesService],
})
export class TablesModule {}
