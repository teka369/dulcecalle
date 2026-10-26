import { expect, test, type Page } from "@playwright/test";
import { BIZ, installFakeApi } from "./fixtures";
import { warmUp } from "./loop-v1-helpers";

/** loop/v1 pass2 pass3 O6: Descartar alertdialog — Escape closes, Tab/Shift+Tab stay inside, focus returns to the trigger. */
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

test("Descartar alertdialog: Escape closes; Tab and Shift+Tab cycle inside; focus returns to Descartar", async ({ context, page }) => {
  await installFakeApi(context);
  await warmUp(page);
  await seedOrphan(page);
  await page.goto("/sincronizacion");
  const row = page.locator("li", { hasText: "Esperando a una operación que se descartó" });
  await expect(row).toBeVisible({ timeout: 15_000 });
  const trigger = row.getByRole("button", { name: "Descartar" });
  const dialog = row.getByRole("alertdialog", { name: "¿Descartar este envío?" });
  const inside = () => dialog.evaluate((d) => d.contains(document.activeElement));

  // Keyboard open, then Escape from a button inside the dialog.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  expect(await inside()).toBe(true);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Descartar" })).toBeFocused();

  // Focus trap: many Tabs and Shift+Tabs never leave the dialog.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await inside(), `Tab #${i + 1}`).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside(), `Shift+Tab #${i + 1}`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Descartar" })).toBeFocused();
});
