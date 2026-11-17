import { expect, test, type Page, type Route } from "@playwright/test";
import { AUTH } from "./fixtures";

test.use({ serviceWorkers: "block" });

const ACCEPTED = {
  ok: true,
  status: "ACCEPTED",
  message:
    "Si el correo es válido, te enviamos un enlace para confirmarlo. Revisa también el correo no deseado.",
};

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function alertText(page: Page) {
  return page.locator("p[role='alert']");
}

async function fillRegister(page: Page, extra?: { email?: string; password?: string; confirm?: string; name?: string }) {
  await page.getByLabel("Nombre").fill(extra?.name ?? "Ana Pérez");
  await page.getByLabel("Correo").fill(extra?.email ?? "ana@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill(extra?.password ?? "clave1234");
  await page.getByLabel("Confirmar contraseña").fill(extra?.confirm ?? extra?.password ?? "clave1234");
}

test.describe("registro público", () => {
  test("registro válido, duplicado y solicitud ya existente muestran el mismo aviso", async ({ page }) => {
    const bodies: unknown[] = [];
    await page.route(/\/v1\/auth\/register$/, async (route) => {
      bodies.push(route.request().postDataJSON());
      await json(route, 201, ACCEPTED);
    });
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();
    await expect(page.locator(".cf-turnstile")).toHaveCount(0);
    await fillRegister(page);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText("Revisa tu correo")).toBeVisible();
    await expect(page.getByText(/Si el correo es válido/)).toBeVisible();
    await expect(page.getByText(/ya existe/i)).toHaveCount(0);
    expect(bodies).toHaveLength(1);
  });

  test("campos vacíos, correo inválido, contraseñas distintas y contraseña débil no llaman al servidor", async ({ page }) => {
    let calls = 0;
    await page.route(/\/v1\/auth\/register$/, async (route) => {
      calls += 1;
      await json(route, 201, ACCEPTED);
    });
    await page.goto("/register");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(alertText(page)).toHaveText("Escribe tu nombre.");

    await page.getByLabel("Nombre").fill("Ana");
    await page.getByLabel("Correo").fill("no-es-correo");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(alertText(page)).toHaveText("Escribe un correo válido.");

    await page.getByLabel("Correo").fill("ana@example.com");
    await page.getByLabel("Contraseña", { exact: true }).fill("clave1234");
    await page.getByLabel("Confirmar contraseña").fill("otra-clave");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(alertText(page)).toHaveText("Las contraseñas no coinciden.");

    await page.getByLabel("Contraseña", { exact: true }).fill("corta");
    await page.getByLabel("Confirmar contraseña").fill("corta");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(alertText(page)).toHaveText("La contraseña debe tener al menos 8 caracteres.");
    expect(calls).toBe(0);
  });

  test("un doble clic envía el formulario una sola vez", async ({ page }) => {
    let calls = 0;
    await page.route(/\/v1\/auth\/register$/, async (route) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 400));
      await json(route, 201, ACCEPTED);
    });
    await page.goto("/register");
    await fillRegister(page);
    await page.evaluate(() => {
      const form = document.querySelector("form");
      if (!form) throw new Error("form missing");
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page.getByText("Revisa tu correo")).toBeVisible();
    expect(calls).toBe(1);
  });

  test("un error del servidor se muestra y el honeypot viaja en el cuerpo", async ({ page }) => {
    await page.route(/\/v1\/auth\/register$/, async (route) => {
      await json(route, 503, errorBody("MAIL_UNAVAILABLE", "No podemos enviar el correo de verificación en este momento."));
    });
    await page.goto("/register");
    await fillRegister(page);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(alertText(page)).toHaveText(/correo de verificación/);

    const honeypot: unknown[] = [];
    await page.unroute(/\/v1\/auth\/register$/);
    await page.route(/\/v1\/auth\/register$/, async (route) => {
      honeypot.push(route.request().postDataJSON());
      await json(route, 201, ACCEPTED);
    });
    await page.locator("#companyWebsite").fill("https://spam.test");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText("Revisa tu correo")).toBeVisible();
    expect(honeypot[0]).toMatchObject({ companyWebsite: "https://spam.test" });
  });

  test("reenviar el enlace avisa sin decir si el correo existe, y un fallo de red se muestra", async ({ page }) => {
    let resends = 0;
    await page.route(/\/v1\/auth\/register$/, (route) => json(route, 201, ACCEPTED));
    await page.route(/\/v1\/auth\/register\/resend$/, async (route) => {
      resends += 1;
      await json(route, 200, { ok: true });
    });
    await page.goto("/register");
    await fillRegister(page);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.getByRole("button", { name: "Reenviar enlace" }).click();
    await expect(page.getByRole("status")).toHaveText(/Si todavía falta confirmar/);
    expect(resends).toBe(1);

    await page.unroute(/\/v1\/auth\/register\/resend$/);
    await page.route(/\/v1\/auth\/register\/resend$/, (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Reenviar enlace" }).click();
    await expect(page.getByRole("status")).toHaveText(/No pudimos reenviar/);
  });

  test("en móvil no hay desborde horizontal y los controles caben", async ({ page }) => {
    await page.goto("/register");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
    const box = await page.getByRole("button", { name: "Crear cuenta" }).boundingBox();
    expect(box && box.height >= 44).toBe(true);
    await expect(page.getByLabel("Nombre")).toBeVisible();
    await expect(page.getByLabel("Confirmar contraseña")).toBeVisible();
  });
});

test.describe("verificación del correo", () => {
  const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";

  test("token válido, vencido, reutilizado, manipulado e inexistente", async ({ page }) => {
    await page.route(/\/v1\/auth\/register\/verify$/, (route) =>
      json(route, 200, { status: "PENDING_ADMIN_APPROVAL" }),
    );
    await page.goto(`/register/verificar?token=${token}`);
    await expect(page.getByRole("status")).toHaveText(/pendiente de aprobación/);

    await page.unroute(/\/v1\/auth\/register\/verify$/);
    await page.route(/\/v1\/auth\/register\/verify$/, (route) =>
      json(route, 403, errorBody("REGISTRATION_EXPIRED", "El enlace venció. Solicita uno nuevo desde el registro.")),
    );
    await page.goto(`/register/verificar?token=${token}`);
    await expect(page.getByRole("status")).toHaveText(/venció/);

    await page.unroute(/\/v1\/auth\/register\/verify$/);
    await page.route(/\/v1\/auth\/register\/verify$/, (route) =>
      json(route, 400, errorBody("VALIDATION", "Este enlace ya no es válido. Si ya confirmaste el correo, espera la aprobación.")),
    );
    await page.goto(`/register/verificar?token=${token}`);
    await expect(page.getByRole("status")).toHaveText(/ya no es válido/);

    let calls = 0;
    await page.unroute(/\/v1\/auth\/register\/verify$/);
    await page.route(/\/v1\/auth\/register\/verify$/, async (route) => {
      calls += 1;
      await json(route, 400, errorBody("VALIDATION", "Este enlace ya no es válido. Si ya confirmaste el correo, espera la aprobación."));
    });
    await page.goto("/register/verificar?token=corto");
    await expect(page.getByRole("status")).toHaveText(/no es válido/);
    expect(calls).toBe(0);

    await page.goto(`/register/verificar?token=${token}xx`);
    await expect(page.getByRole("status")).toHaveText(/ya no es válido/);
    expect(calls).toBe(1);
  });

  test("una segunda visita con el mismo enlace muestra el resultado de esa confirmación", async ({ page }) => {
    let calls = 0;
    await page.route(/\/v1\/auth\/register\/verify$/, async (route) => {
      calls += 1;
      if (calls === 1) await json(route, 200, { status: "PENDING_ADMIN_APPROVAL" });
      else {
        await json(
          route,
          400,
          errorBody("VALIDATION", "Este enlace ya no es válido. Si ya confirmaste el correo, espera la aprobación."),
        );
      }
    });
    await page.goto(`/register/verificar?token=${token}`);
    await expect(page.getByRole("status")).toHaveText(/pendiente de aprobación/);
    await page.goto(`/register/verificar?token=${token}`);
    await expect(page.getByRole("status")).toHaveText(/ya no es válido/);
    expect(calls).toBe(2);
  });

  test("un corte de red no dice que el correo quedó confirmado", async ({ page }) => {
    await page.route(/\/v1\/auth\/register\/verify$/, (route) => route.abort("internetdisconnected"));
    await page.goto(`/register/verificar?token=${token}`);
    await expect(page.getByRole("status")).toHaveText(/No pudimos confirmar/);
    await expect(page.getByText("Listo")).toHaveCount(0);
  });
});

test.describe("panel administrativo", () => {
  const row = {
    id: "00000000-0000-4000-8000-0000000000aa",
    name: "Ana Pérez",
    email: "ana@example.com",
    status: "PENDING_ADMIN_APPROVAL",
    emailVerifiedAt: "2026-11-17T12:00:00.000Z",
    createdAt: "2026-11-17T11:00:00.000Z",
    decidedAt: null,
    decisionNote: null,
    decidedByEmail: null,
    userId: null,
    businessId: null,
    expiresAt: "2026-11-24T11:00:00.000Z",
  };

  test("sin sesión vuelve al login", async ({ page }) => {
    await page.goto("/admin/registros");
    await expect(page).toHaveURL(/\/login/);
  });

  test("un usuario normal ve el rechazo y no los botones de decisión", async ({ page }) => {
    await page.addInitScript((auth) => localStorage.setItem("dulcecalle.auth", auth), JSON.stringify(AUTH));
    await page.route(/\/v1\/admin\/registrations/, (route) =>
      json(route, 403, errorBody("FORBIDDEN", "No tienes permiso.")),
    );
    await page.goto("/admin/registros");
    await expect(alertText(page)).toHaveText("No tienes permiso para ver las solicitudes.");
    await expect(page.getByRole("button", { name: "Aprobar", exact: true })).toHaveCount(0);
  });

  test("lista, aprueba, rechaza, ignora una decisión ya tomada y muestra la carga", async ({ page }) => {
    await page.addInitScript((auth) => localStorage.setItem("dulcecalle.auth", auth), JSON.stringify(AUTH));
    let releaseList!: () => void;
    const holdFirstList = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    let listCalls = 0;
    let approveCalls = 0;
    let rejectCalls = 0;
    let listingApproved = false;
    await page.route(/\/v1\/admin\/registrations/, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (method === "GET" && url.pathname.endsWith("/registrations")) {
        listCalls += 1;
        listingApproved = url.searchParams.get("status") === "APPROVED";
        if (listCalls === 1) await holdFirstList;
        await json(route, 200, listingApproved ? [{ ...row, status: "APPROVED" }] : [row]);
        return;
      }
      if (method === "GET") {
        await json(route, 200, {
          ...(listingApproved ? { ...row, status: "APPROVED" } : row),
          history: [{ id: "h1", action: "email_verified", note: null, createdAt: row.createdAt, actorEmail: null }],
        });
        return;
      }
      if (method === "POST" && url.pathname.endsWith("/approve")) {
        approveCalls += 1;
        await json(route, 409, errorBody("CONFLICT", "Esa solicitud ya no se puede aprobar."));
        return;
      }
      if (method === "POST" && url.pathname.endsWith("/reject")) {
        rejectCalls += 1;
        await json(route, 200, { status: "REJECTED", idempotent: false });
        return;
      }
      await json(route, 404, errorBody("NOT_FOUND", "No encontramos esa solicitud."));
    });
    const pending = page.goto("/admin/registros");
    await expect(page.getByText("Cargando solicitudes…")).toBeVisible();
    releaseList();
    await pending;
    await expect(page.getByText("Ana Pérez")).toBeVisible();
    await page.getByRole("button", { name: /Ana Pérez/ }).click();
    await expect(page.getByText("email_verified")).toBeVisible();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Aprobar", exact: true }).click();
    expect(approveCalls).toBe(0);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Aprobar", exact: true }).click();
    await expect(alertText(page)).toHaveText(/ya no se puede aprobar/);
    expect(approveCalls).toBe(1);

    await page.getByLabel("Nota si la rechazas (opcional)").fill("No es un negocio de dulces.");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Rechazar" }).click();
    expect(rejectCalls).toBe(1);

    await page.getByRole("button", { name: "Aprobadas" }).click();
    await expect(page.getByText("Ana Pérez")).toBeVisible();
    await page.getByRole("button", { name: /Ana Pérez/ }).click();
    await expect(page.getByRole("button", { name: "Aprobar", exact: true })).toHaveCount(0);
  });

  test("un corte de red deja el mensaje de conexión", async ({ page }) => {
    await page.addInitScript((auth) => localStorage.setItem("dulcecalle.auth", auth), JSON.stringify(AUTH));
    await page.route(/\/v1\/admin\/registrations/, (route) => route.abort("internetdisconnected"));
    await page.goto("/admin/registros");
    await expect(alertText(page)).toHaveText(/Sin conexión/);
  });

  test("en una pantalla ancha el panel sigue siendo usable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript((auth) => localStorage.setItem("dulcecalle.auth", auth), JSON.stringify(AUTH));
    await page.route(/\/v1\/admin\/registrations/, (route) => json(route, 200, [row]));
    await page.goto("/admin/registros");
    await expect(page.getByRole("heading", { name: "Solicitudes" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});

test("Más muestra Solicitudes solo si la sesión es de administrador de plataforma", async ({ page }) => {
  await page.addInitScript((auth) => localStorage.setItem("dulcecalle.auth", auth), JSON.stringify(AUTH));
  await page.route(/\/v1\//, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/me") || url.endsWith("/me")) {
      await json(route, 200, {
        id: "u1",
        email: "qa@example.invalid",
        platformAdmin: false,
        memberships: [{ businessId: AUTH.businessId, role: "owner", business: { id: AUTH.businessId, name: "Tienda", timezone: "America/Bogota" } }],
      });
      return;
    }
    await json(route, 200, []);
  });
  await page.goto("/mas");
  await expect(page.getByRole("heading", { name: "Más" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Solicitudes de registro" })).toHaveCount(0);

  await page.unroute(/\/v1\//);
  await page.route(/\/v1\//, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/me") || url.endsWith("/me")) {
      await json(route, 200, {
        id: "u1",
        email: "admin@dulce.test",
        platformAdmin: true,
        memberships: [{ businessId: AUTH.businessId, role: "owner", business: { id: AUTH.businessId, name: "Tienda", timezone: "America/Bogota" } }],
      });
      return;
    }
    await json(route, 200, []);
  });
  await page.reload();
  await expect(page.getByRole("link", { name: "Solicitudes de registro" })).toBeVisible();
});
