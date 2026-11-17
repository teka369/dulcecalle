/** Comma-separated login emails allowed to approve registrations. */
export function platformAdminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformAdminEmail(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return platformAdminEmails(env).has(email.trim().toLowerCase());
}

export function registrationAdminEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.REGISTRATION_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  return value || null;
}

export function appPublicUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return value || "https://dulcecalle.vercel.app";
}
