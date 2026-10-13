/**
 * TICKET-A (J-A2) — manual-review backfill for Product.kind.
 *
 * The Prisma migration sets every product to `standard`. Nothing becomes a
 * combo automatically. This tool:
 *   list   (read-only) → candidates markdown for Juan to review
 *   apply  → reclassifies ONLY the ids Juan confirmed, ONLY with --confirm,
 *            and refuses production-looking environments.
 *
 *   npx tsx migration/combo-kind.ts list  > candidates.md
 *   npx tsx migration/combo-kind.ts apply --ids=<uuid,uuid> --confirm
 *
 * NEVER part of `prisma migrate deploy` / start:render. Not run in prod.
 */
import { PrismaClient } from "@prisma/client";

export type CandidateInput = {
  id: string;
  businessId: string;
  name: string;
  sellable: boolean;
  kind: "standard" | "combo";
  stock: number;
  avgCost: bigint;
  archivedAt: Date | null;
  preparationsAsSource: number;
  surtidos: number;
};

export type Candidate = CandidateInput & { reasons: string[]; confidence: "alta" | "media" | "baja" };

/** Pure: which standard products look like combos. Never decides; only lists. */
export function comboCandidates(rows: ReadonlyArray<CandidateInput>): Candidate[] {
  const out: Candidate[] = [];
  for (const r of rows) {
    if (r.kind === "combo" || r.archivedAt) continue;
    if (r.sellable) continue; // sellable products are never combos
    const reasons = ["sellable:false (no vendible)"];
    if (r.preparationsAsSource > 0) reasons.push(`origen de ${r.preparationsAsSource} preparación(es)`);
    if (r.surtidos > 0) reasons.push(`${r.surtidos} surtido(s)`);
    if (r.avgCost > 0n) reasons.push(`valor de lote $${r.avgCost.toString()}`);
    const confidence = r.preparationsAsSource > 0 ? "alta" : r.surtidos > 0 ? "media" : "baja";
    out.push({ ...r, reasons, confidence });
  }
  const rank = { alta: 0, media: 1, baja: 2 } as const;
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.name.localeCompare(b.name));
}

export function candidatesMarkdown(list: ReadonlyArray<Candidate>, source: string): string {
  const lines = [
    "# Candidatos a kind=combo (revisión manual, J-A2)",
    "",
    `Fuente: ${source}. Nada se aplicó. Juan marca los que SÍ son combos.`,
    "",
    "| ✔ | Confianza | Producto | id | Stock | Motivos |",
    "|---|---|---|---|---|---|",
    ...list.map((c) => `| [ ] | ${c.confidence} | ${c.name} | \`${c.id}\` | ${c.stock} | ${c.reasons.join("; ")} |`),
  ];
  if (list.length === 0) lines.push("| | | _(sin candidatos)_ | | | |");
  return lines.join("\n") + "\n";
}

/** Refuse anything that looks like production. */
export function assertNotProduction(env: NodeJS.ProcessEnv): void {
  const url = env.DATABASE_URL ?? "";
  if (env.NODE_ENV === "production" || env.RENDER || /render\.com|neon\.tech|supabase|amazonaws/i.test(url)) {
    throw new Error("combo-kind apply: entorno de producción detectado; no se ejecuta.");
  }
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const prisma = new PrismaClient();
  try {
    if (cmd === "list") {
      const products = await prisma.product.findMany({ where: { kind: "standard", sellable: false } });
      const rows: CandidateInput[] = [];
      for (const p of products) {
        rows.push({
          ...p,
          preparationsAsSource: await prisma.preparation.count({ where: { sourceId: p.id } }),
          surtidos: await prisma.stockMove.count({ where: { productId: p.id, reason: "surtir" } }),
        });
      }
      process.stdout.write(candidatesMarkdown(comboCandidates(rows), "base de datos local (solo lectura)"));
      return;
    }
    if (cmd === "apply") {
      assertNotProduction(process.env);
      const ids = (rest.find((a) => a.startsWith("--ids=")) ?? "").slice(6).split(",").filter(Boolean);
      if (!rest.includes("--confirm") || ids.length === 0) {
        throw new Error("Uso: apply --ids=<uuid,...> --confirm (ids confirmados por Juan).");
      }
      // Only non-sellable standard rows: their cost is already lot value, so
      // the reclassification does not change cost/stock behaviour (AC6).
      const r = await prisma.product.updateMany({
        where: { id: { in: ids }, kind: "standard", sellable: false },
        data: { kind: "combo" },
      });
      process.stdout.write(`combo-kind: ${r.count} de ${ids.length} producto(s) marcados como combo.\n`);
      return;
    }
    throw new Error("Comando: list | apply");
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
