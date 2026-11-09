import { expect, test, type Page } from "@playwright/test";
import { BIZ, installFakeApi, PROD } from "./fixtures";

/**
 * C01.4 / C013-INV-01 — after «Registrar de nuevo», the discard dialog must
 * reuse the INV-03 warning when the original already had attempts > 0, and
 * hide it when attempts = 0.
 */
const REJECTED_ID = "00000000-0000-4000-8000-00000000c140";
const SALE_ID = "00000000-0000-4000-8000-00000000c147";
const REQUEST_ID = "00000000-0000-4000-8000-00000000c149";
const WARNING =
  "Ya se intentó enviar. Puede que haya llegado al servidor: revisa antes de registrarla de nuevo.";

async function ready(page: Page) {
  await page.goto("/");
  await page.goto("/ventas/nueva");
  await expect(page.getByRole("button", { name: `Agregar ${PROD.name}` })).toBeVisible({ timeout: 30_000 });
}

async function acceptCorrectionSale(
  context: import("@playwright/test").BrowserContext,
  fake: Awaited<ReturnType<typeof installFakeApi>>,
) {
  await context.route(/\/v1\/sales(\/[^/?]+)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && /\/sales$/.test(url.pathname)) {
      const body = (req.postDataJSON() ?? {}) as {
        customerId?: string | null;
        paymentKind?: string;
        method?: string;
        saleTotal?: number;
        amountReceived?: number;
        credit?: number;
        note?: string | null;
        lines?: Array<{ productId: string; productName?: string; qty: number; unitPrice?: number }>;
      };
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
      const lines = (body.lines ?? []).map((l, i) => ({
        id: `00000000-0000-4000-8000-0000000007${String(10 + i)}`,
        productId: l.productId,
        productName: l.productName ?? PROD.name,
        qty: l.qty,
        unitPrice: l.unitPrice ?? PROD.price,
        unitCost: 400,
        lineTotal: l.qty * (l.unitPrice ?? PROD.price),
      }));
      const total = lines.reduce((a, l) => a + l.lineTotal, 0) || 1500;
      const sale = {
        id: SALE_ID,
        customerId: body.customerId ?? null,
        paymentKind: body.paymentKind ?? "paid",
        method: body.method ?? "Efectivo",
        saleTotal: body.saleTotal ?? total,
        amountReceived: body.amountReceived ?? total,
        credit: body.credit ?? 0,
        note: body.note ?? null,
        occurredOn: today,
        createdAt: new Date().toISOString(),
        lines,
      };
      fake.server.extraSales.push(sale);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(sale) });
    }
    return route.fallback();
  });
}

async function seedRejectedSale(page: Page, attempts: number) {
  await page.evaluate(
    ({ biz, id, requestId, attempts }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("dulcecalle-local");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          try {
            if (!db.objectStoreNames.contains("outbox")) {
              db.close();
              reject(new Error("outbox store missing"));
              return;
            }
            const tx = db.transaction("outbox", "readwrite");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
            tx.objectStore("outbox").put({
              operationId: id,
              businessId: biz,
              entity: "sale",
              operation: "create",
              requestId,
              payload: {
                paymentKind: "paid",
                method: "Efectivo",
                saleTotal: 1500,
                amountReceived: 1500,
                credit: 0,
                lines: [],
              },
              dependsOn: [],
              localCreatedAt: Date.now(),
              status: "failed",
              remoteId: null,
              attempts,
              lastError: "La caja de ese día ya está cerrada.",
              nextAttemptAt: null,
              rejection: { code: "CLOSED_DAY", at: Date.now() },
            });
          } catch (err) {
            reject(err);
          }
        };
      }),
    { biz: BIZ, id: REJECTED_ID, requestId: REQUEST_ID, attempts },
  );
}

async function openDiscardDialog(page: Page) {
  await page.goto(`/ventas/nueva?rechazada=${REJECTED_ID}`);
  await page.getByRole("button", { name: `Agregar ${PROD.name}` }).click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  await expect(page).toHaveURL(/rechazada=/);
  await page.getByRole("button", { name: "Registrar" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("¿Descartar la operación rechazada?", { timeout: 15_000 });
  return dialog;
}

test("discard dialog shows INV-03 warning when the rejected op was already attempted", async ({
  page,
  context,
}) => {
  const fake = await installFakeApi(context);
  await acceptCorrectionSale(context, fake);
  await ready(page);
  await seedRejectedSale(page, 1);
  const dialog = await openDiscardDialog(page);
  await expect(dialog.getByTestId("discard-attempted-warning")).toBeVisible();
  await expect(dialog.getByTestId("discard-attempted-warning")).toHaveText(WARNING);
});

test("discard dialog hides INV-03 warning when the rejected op was never attempted", async ({
  page,
  context,
}) => {
  const fake = await installFakeApi(context);
  await acceptCorrectionSale(context, fake);
  await ready(page);
  await seedRejectedSale(page, 0);
  const dialog = await openDiscardDialog(page);
  await expect(dialog.getByTestId("discard-attempted-warning")).toHaveCount(0);
});
