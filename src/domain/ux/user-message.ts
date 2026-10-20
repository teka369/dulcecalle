/**
 * loop/v1: technical text (validator messages, client mapper/contract errors,
 * runtime exceptions, English server defaults) never reaches the user. Plain
 * Spanish messages pass through; anything that looks technical → fallback.
 */
const TECHNICAL =
  /\b(must|should|is not|not found|undefined|null|NaN|uuid|json|typeerror|referenceerror|syntaxerror|cannot|unexpected|invalid|internal server|bad request|forbidden|unauthorized|got|reading|properties|token|stack|ECONN\w*|status code)\b|[a-z]+\.[a-z]+\s|[{}<>]|=>/i;

export function userFacingMessage(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? "").replace(/^(TypeError|Error|ApiError|ContractError)\s*:\s*/i, "").trim();
  if (!text) return fallback;
  if (TECHNICAL.test(text)) return fallback;
  return text;
}
