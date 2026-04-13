import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const products = await this.prisma.product.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    return products.map((product) => ({
      ...product,
      price: this.toNumber(product.price),
    }));
  }

  private toNumber(value: Prisma.Decimal | number) {
    return Number(value);
  }
}
