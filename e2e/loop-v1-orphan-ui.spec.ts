import { expect, test, type Page } from "@playwright/test";
import { BIZ, installFakeApi } from "./fixtures";
import { warmUp } from "./loop-v1-helpers";

/** loop/v1 pass2 O1/O2/O3: orphan outbox row — AA contrast in dark, consistent copy, no «En espera», focus management. */
const PARENT = "00000000-0000-4000-8000-00000000f001";
const CHILD = "00000000-0000-4000-8000-00000000f002";

async function seedOrphan(page: Page) {
  await page.evaluate(
    ({ biz, parent, child }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("dulcecalle-local");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("outbox", "readwrite");
          tx.objectStore("outbox").put({
            operationId: child, businessId: biz, entity: "cashMove", operation: "create",
            requestId: "00000000-0000-4000-8000-00000000f003", payload: { amount: 5000 }, dependsOn: [parent],
            localCreatedAt: Date.now(), status: "pending", remoteId: null, attempts: 0, lastError: null, nextAttemptAt: null,
          });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { biz: BIZ, parent: PARENT, child: CHILD },
  );
}

function ratio(fg: string, bg: string): number {
  const lum = (c: string) => {
    const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test("orphan row: chip not «En espera», copy says Descartar, focus in/out, AA contrast light + dark", async ({ context, page }) => {
  await installFakeApi(context);
  await warmUp(page);
  await seedOrphan(page);
  await page.goto("/sincronizacion");
  const row = page.locator("li", { hasText: "Esperando a una operación que se descartó" });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).not.toContainText("En espera");
  await expect(row).toContainText("No se puede enviar");

  const trigger = row.getByRole("button", { name: "Descartar" });
  await trigger.click();
  const dialog = row.getByRole("alertdialog", { name: "¿Descartar este envío?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/^.*Descartar elimina/);
  await expect(dialog).not.toContainText("No enviar");
  // Focus moved into the confirmation.
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);

  const confirm = dialog.getByRole("button", { name: "Descartar" });
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((m) => { if (m === "dark") document.documentElement.dataset.mode = "dark"; else delete document.documentElement.dataset.mode; }, mode);
    const { color, bg } = await confirm.evaluate((el) => { const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundColor }; });
    const r = ratio(color, bg);
    console.log(`O1 ${mode}: ${color} on ${bg} = ${r.toFixed(2)}:1`);
    expect(r).toBeGreaterThanOrEqual(4.5);
  }

  // Cancel returns focus to the trigger.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Descartar" })).toBeFocused();
});
