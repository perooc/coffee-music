import { Module } from "@nestjs/common";
import { ExtraIncomeController } from "./extra-income.controller";
import { ExtraIncomeService } from "./extra-income.service";

@Module({
  controllers: [ExtraIncomeController],
  providers: [ExtraIncomeService],
  exports: [ExtraIncomeService],
})
export class ExtraIncomeModule {}
