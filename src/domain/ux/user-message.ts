/**
 * loop/v1: technical text (validator messages, client mapper/contract errors,
 * runtime exceptions, English server defaults) never reaches the user. Plain
 * Spanish messages pass through; anything that looks technical → fallback.
 */
const TECHNICAL =
  /\b(must|should|is not|not found|undefined|null|NaN|uuid|json|typeerror|referenceerror|syntaxerror|cannot|unexpected|invalid|internal server|bad request|forbidden|unauthorized|got|reading|properties|token|stack|ECONN\w*|status code)\b|[a-z]+\.[a-z]+\s|[{}<>]|=>/i;

/** Known English / technical messages (client store + Nest/validator defaults) → clear Spanish. */
const KNOWN: Array<[RegExp, string]> = [
  [/\bproduct not found\b/i, "No encontramos ese producto."],
  [/\bcustomer not found\b/i, "No encontramos ese cliente."],
  [/\bsupplier not found\b/i, "No encontramos ese proveedor."],
  [/\bsale not found\b/i, "No encontramos esa venta."],
  [/\b(session|cash ?session|caja) not found\b/i, "No encontramos esa caja."],
  [/failed to fetch|networkerror|load failed|network request failed|ECONN\w*/i, "Sin conexión. Revisa tu internet e inténtalo de nuevo."],
  [/timeout|timed out|aborted/i, "El servidor tardó demasiado. Inténtalo de nuevo."],
  [/\b(qty|quantity|delta|stock)\b.*must be .*integer/i, "Escribe una cantidad entera válida."],
  [/\bCOP must be\b/i, "Escribe el monto en pesos, sin centavos."],
  [/\b(unauthori[sz]ed|jwt expired|invalid token)\b/i, "Tu sesión expiró. Vuelve a entrar."],
  [/\bforbidden\b/i, "No tienes permiso para hacer esto."],
  [/too many requests|throttl/i, "Demasiados intentos. Espera un momento e inténtalo de nuevo."],
  [/\b(insufficient|not enough) stock\b/i, "No hay suficiente stock."],
  [/\bnot found\b/i, "No encontramos eso."],
  [/\b(should not be empty|must be|must not|should be)\b/i, "Revisa los datos e inténtalo de nuevo."],
];

export function userFacingMessage(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? "").replace(/^(TypeError|Error|ApiError|ContractError|ThrottlerException)\s*:\s*/i, "").trim();
  if (!text) return fallback;
  for (const [re, es] of KNOWN) if (re.test(text)) return es;
  if (TECHNICAL.test(text)) return fallback;
  return text;
}

const GENERIC_FALLBACK = "No se pudo completar. Inténtalo de nuevo.";

/**
 * Inline form/action error text from a caught value: known messages mapped,
 * useful Spanish kept, technical text → the fallback (a bare «Error» fallback
 * becomes a clear Spanish sentence; "" stays "" for callers with their own default).
 */
export function errorText(e: unknown, fallback: string): string {
  const fb = fallback === "Error" ? GENERIC_FALLBACK : fallback;
  if (!(e instanceof Error)) return fb;
  return userFacingMessage(e.message, fb);
}

export function toUserErrorMessage(e: unknown, fallback = GENERIC_FALLBACK): string {
  return errorText(e, fallback);
}
