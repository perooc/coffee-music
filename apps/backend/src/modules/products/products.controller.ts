import { Controller, Get } from "@nestjs/common";
import { ProductsService } from "./products.service";

/**
 * Public catalog. Used by the customer cart on /mesa/:id and by anyone
 * else with internet access. Filters out inactive products so they cannot
 * be ordered.
 */
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll() {
    return this.productsService.findAllForCustomers();
  }
}
