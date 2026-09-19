/** Access + refresh secrets. No fallback. Fail closed. */
export function requireJwtSecrets(): { access: string; refresh: string } {
  const access = process.env.JWT_SECRET?.trim() ?? "";
  const refresh = process.env.JWT_REFRESH_SECRET?.trim() ?? "";
  if (!access || !refresh) {
    throw new Error("JWT_SECRET and JWT_REFRESH_SECRET are required.");
  }
  return { access, refresh };
}
