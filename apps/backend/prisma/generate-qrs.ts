/**
 * Reads a JSON of {table_id, number, url} entries (the output of
 * `print-table-tokens --json out/qrs.json`) and renders one PNG per
 * entry under ./qrs/.
 *
 * Usage:
 *   npx tsx prisma/generate-qrs.ts ./out/qrs.json
 *
 * Defaults the output directory to ./qrs and the size to 1200×1200,
 * which is plenty for laser-printer 8–10 cm decals. Margin 2 keeps the
 * white quiet-zone tight without sacrificing scannability.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import QRCode from "qrcode";

interface TableLink {
  table_id: number;
  number: number;
  url: string;
}

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error(
      "[generate-qrs] No input JSON provided. Run print-table-tokens with --json first.",
    );
    console.error(
      '  Usage: npx tsx prisma/generate-qrs.ts <json-path> [out-dir]',
    );
    process.exit(1);
  }

  const inputPath = resolve(inputArg);
  if (!existsSync(inputPath)) {
    console.error(`[generate-qrs] File not found: ${inputPath}`);
    process.exit(1);
  }

  const links = JSON.parse(readFileSync(inputPath, "utf8")) as TableLink[];
  if (!Array.isArray(links) || links.length === 0) {
    console.error("[generate-qrs] Input JSON is empty or not an array.");
    process.exit(1);
  }

  const outDir = resolve(process.argv[3] ?? "./qrs");
  mkdirSync(outDir, { recursive: true });
  // The path printed below depends on the cwd, but the dirname is
  // calculated from the resolved out path so user-supplied "./qrs"
  // and "qrs/" both work.
  void dirname;

  for (const item of links) {
    const filename = `mesa-${String(item.number).padStart(2, "0")}.png`;
    const filePath = `${outDir}/${filename}`;
    await QRCode.toFile(filePath, item.url, {
      width: 1200,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#2B1D14", // ink — keeps it on-brand if you print B&W
        light: "#FFFDF8", // paper — same cream as the app
      },
    });
    console.log(`[generate-qrs] mesa-${item.number} → ${filePath}`);
  }

  console.log(
    `\n[generate-qrs] Done. ${links.length} QR code(s) written to ${outDir}`,
  );
}

main().catch((err) => {
  console.error("[generate-qrs] Failed:", err);
  process.exit(1);
});
