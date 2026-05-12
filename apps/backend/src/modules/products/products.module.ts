import { Module } from "@nestjs/common";
import { AdminInventoryMovementsController } from "./admin-inventory-movements.controller";
import { AdminProductsController } from "./admin-products.controller";
import { InventoryMovementsService } from "./inventory-movements.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [AuditLogModule],
  controllers: [
    ProductsController,
    AdminProductsController,
    AdminInventoryMovementsController,
  ],
  providers: [ProductsService, InventoryMovementsService],
  exports: [ProductsService, InventoryMovementsService],
})
export class ProductsModule {}
