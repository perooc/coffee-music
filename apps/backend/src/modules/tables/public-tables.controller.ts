import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { TableStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { TokenService } from "../auth/token.service";

/**
 * Temporary public surface used while the bar hasn't printed physical QR
 * codes yet. Two endpoints, both gated by `BAR_ACCESS_CODE`:
 *
 *   GET  /public/tables/available     → list of free tables for the picker
 *   POST /public/tables/:id/access    → mints a 12h table token for the
 *                                        chosen mesa
 *
 * When physical QRs ship, set `ALLOW_PUBLIC_TABLE_TOKENS=false` in the
 * host's env to disable both endpoints. The rest of the customer flow
 * (`/mesa/:id?t=…` → `POST /table-sessions/open`) is unchanged.
 */
@Controller("public/tables")
export class PublicTablesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  @Get("available")
  async listAvailable() {
    this.assertEnabled();
    const tables = await this.prisma.table.findMany({
      where: { status: TableStatus.available, current_session_id: null },
      orderBy: { number: "asc" },
      select: { id: true, number: true, status: true },
    });
    return tables;
  }

  @Post(":id/access")
  @HttpCode(200)
  async issueAccessToken(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { code?: string },
  ) {
    this.assertEnabled();
    this.assertCode(body?.code);

    const table = await this.prisma.table.findUnique({
      where: { id },
      select: { id: true, number: true, status: true, current_session_id: true },
    });
    if (!table) {
      throw new NotFoundException({
        message: `Mesa ${id} no encontrada`,
        code: "TABLE_NOT_FOUND",
      });
    }
    // We only mint tokens for tables that are visibly free. If two
    // customers race for the same table, the second one will see the table
    // as occupied (current_session_id != null) once the first opens the
    // session, so this also serves as a soft uniqueness guarantee.
    if (
      table.status !== TableStatus.available ||
      table.current_session_id !== null
    ) {
      throw new BadRequestException({
        message: "Esa mesa ya no está disponible",
        code: "TABLE_NOT_AVAILABLE",
      });
    }

    const token = this.tokens.signTableShortLived(
      { table_id: table.id },
      "12h",
    );
    return {
      table: { id: table.id, number: table.number },
      table_token: token,
      expires_in: "12h",
    };
  }

  private assertEnabled() {
    if (process.env.ALLOW_PUBLIC_TABLE_TOKENS !== "true") {
      throw new ServiceUnavailableException({
        message: "Acceso público a mesas deshabilitado",
        code: "PUBLIC_TABLES_DISABLED",
      });
    }
  }

  private assertCode(code: string | undefined) {
    const expected = process.env.BAR_ACCESS_CODE;
    if (!expected) {
      // If the env var isn't set, refuse to mint anything — fail closed,
      // not open. The admin must explicitly configure the access code.
      throw new ServiceUnavailableException({
        message: "Acceso público a mesas no configurado",
        code: "PUBLIC_TABLES_NOT_CONFIGURED",
      });
    }
    if (typeof code !== "string" || code.trim().length === 0) {
      throw new ForbiddenException({
        message: "Falta el código del bar",
        code: "BAR_CODE_REQUIRED",
      });
    }
    if (code.trim() !== expected) {
      throw new ForbiddenException({
        message: "Código del bar incorrecto",
        code: "BAR_CODE_INVALID",
      });
    }
  }
}
