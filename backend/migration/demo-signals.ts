import type { DexieDump, ImportWarning } from "./types";

const DEMO_NAMES = new Set([
  "Doña Rosa",
  "Carlos",
  "Chicle menta",
  "Chocolate barra",
  "Gomitas oso",
  "Caramelo duro",
  "Bombón café",
  "Distribuidora Sol",
]);

/** Hints only. Never delete. Owner decides at real import time. */
export function detectDemoSignals(dump: DexieDump): ImportWarning[] {
  const hits: string[] = [];
  for (const p of dump.tables.products) {
    if (DEMO_NAMES.has(p.name)) hits.push(`product:${p.name}`);
  }
  for (const c of dump.tables.customers) {
    if (DEMO_NAMES.has(c.name)) hits.push(`customer:${c.name}`);
  }
  for (const s of dump.tables.suppliers) {
    if (DEMO_NAMES.has(s.name)) hits.push(`supplier:${s.name}`);
  }
  const demoLoaded = dump.tables.settings.find((x) => x.key === "demoLoaded");
  if (demoLoaded?.value === "1") hits.push("settings.demoLoaded=1");
  if (hits.length === 0) return [];
  return [
    {
      code: "DEMO_SIGNALS",
      message: `Possible demo rows (not deleted): ${hits.join(", ")}`,
    },
  ];
}
