import { AppError, ERROR_CODES } from "../shared/errors";

type Siteverify = { success?: boolean };

/**
 * Cloudflare Turnstile. Enforced only when TURNSTILE_SECRET_KEY is set,
 * so local and CI keep working before the widget is configured.
 */
export async function assertTurnstile(
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return;
  if (!token?.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION, "Confirma que no eres un robot.");
  }
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token.trim());
  let payload: Siteverify;
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    payload = (await res.json()) as Siteverify;
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION, "No pudimos comprobar el captcha. Inténtalo de nuevo.");
  }
  if (!payload.success) {
    throw new AppError(ERROR_CODES.VALIDATION, "No pudimos comprobar el captcha. Inténtalo de nuevo.");
  }
}
