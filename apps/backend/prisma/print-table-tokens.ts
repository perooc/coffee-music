/**
 * Reads every Table from the DB, mints a 365-day table_token for each
 * one, and prints the full QR URL (`<base>/mesa/:id?t=<token>`).
 * Idempotent — does not mutate data. Run any time you need the QR
 * payloads (lost the seed output, added a new table, rotated JWT_SECRET).
 *
 *   QR_BASE_URL=https://crown490.com \
 *   DATABASE_URL=postgresql://... \
 *   JWT_SECRET=...                   \
 *   npx tsx prisma/print-table-tokens.ts [--json out/qrs.json]
 *
 * Flags:
 *   --json <path>   Also write a JSON array to <path> so the QR-image
 *                   generator can pick it up without copy-paste.
 *   --base <url>    Override QR_BASE_URL on the fly. Defaults to env or
 *                   http://localhost:3000.
 */
import { PrismaClient } from "@prisma/client";
import * as jwt from "jsonwebtoken";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const prisma = new PrismaClient();

interface TableLink {
  table_id: number;
  number: number;
  token: string;
  url: string;
}

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[print-table-tokens] JWT_SECRET is missing");
    process.exit(1);
  }

  const baseUrl =
    readArg("--base") ?? process.env.QR_BASE_URL ?? "http://localhost:3000";
  const jsonPath = readArg("--json");

  const tables = await prisma.table.findMany({ orderBy: { number: "asc" } });
  if (tables.length === 0) {
    console.error(
      "[print-table-tokens] No tables in DB. Run `npx tsx prisma/seed.ts` first.",
    );
    process.exit(1);
  }

  const links: TableLink[] = tables.map((t) => {
    const token = jwt.sign(
      { kind: "table", table_id: t.id },
      secret,
      { expiresIn: "365d" },
    );
    return {
      table_id: t.id,
      number: t.number,
      token,
      url: `${baseUrl.replace(/\/+$/, "")}/mesa/${t.id}?t=${token}`,
    };
  });

  console.log("\n─── Table QR URLs ────────────────────────────────────────");
  console.log(`Base: ${baseUrl}`);
  console.log(`Tables: ${links.length}\n`);
  for (const l of links) {
    console.log(`mesa ${String(l.number).padStart(2, "0")} (id=${l.table_id}):`);
    console.log(`  ${l.url}`);
  }
  console.log("──────────────────────────────────────────────────────────\n");

  if (jsonPath) {
    const abs = resolve(jsonPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(links, null, 2));
    console.log(`[print-table-tokens] Wrote ${links.length} entries to ${abs}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
