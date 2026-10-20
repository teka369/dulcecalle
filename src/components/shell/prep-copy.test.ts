import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepTaskDefs } from "@/data/pwa/offline-prep";

/** loop/v1 pass2 D8: the «Preparando» popup speaks plain Spanish — no technical terms. */
const TECH = /Service Worker|Documento|documento|Cache Storage|cacheado|snapshot|tareas/;

describe("Preparando popup copy (D8)", () => {
  it("task labels are plain Spanish", () => {
    for (const t of prepTaskDefs()) expect(t.label).not.toMatch(TECH);
  });
  it("user-visible strings in the prep pipeline and modal avoid technical terms", () => {
    const prep = readFileSync("src/data/pwa/offline-prep.ts", "utf8");
    const shown = [...prep.matchAll(/(?:new Error\(|return |label: )[`"]([^`"]*)[`"]/g)].map((m) => m[1]);
    for (const s of shown) expect(s).not.toMatch(TECH);
    const modal = readFileSync("src/components/shell/PrepModal.tsx", "utf8").replace(/\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, "");
    expect(modal).not.toMatch(TECH);
  });
});

describe("Preparando popup copy (pass3)", () => {
  it("system steps use simple words, not «Almacenamiento» / «Verificación»", () => {
    const prep = readFileSync("src/data/pwa/offline-prep.ts", "utf8");
    const labels = [...prep.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).not.toContain("Almacenamiento");
    expect(labels).not.toContain("Verificación");
    expect(prep).toMatch(/key: "sys:storage", group: "sistema", label: "Espacio en el teléfono"/);
    expect(prep).toMatch(/key: "sys:verify",\s+group: "sistema",\s+label: "Revisión"/);
  });
});
