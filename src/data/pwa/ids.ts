const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function routeId(
  param: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw || !UUID.test(raw)) return null;
  return raw;
}
