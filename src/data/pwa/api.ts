import { apiBaseUrl } from "../backend";
import { HttpRepository } from "../http/repository";
import { PREP_READ_TIMEOUT_MS } from "../http/client";
import { getPwaAuthSession } from "../http/session";

let repo: HttpRepository | null = null;

export function getPwaApi(): HttpRepository {
  const base = apiBaseUrl();
  if (!base) {
    throw new Error("El servidor no está configurado.");
  }
  const session = getPwaAuthSession();
  if (!repo) {
    repo = new HttpRepository(base, session);
  }
  return repo;
}

let prepRepo: HttpRepository | null = null;

/**
 * Same session/API as getPwaApi, but GET reads get the 30s offline-prep
 * deadline. Use ONLY from offline prep downloads; writes are unaffected.
 */
export function getPrepPwaApi(): HttpRepository {
  const base = apiBaseUrl();
  if (!base) {
    throw new Error("El servidor no está configurado.");
  }
  if (!prepRepo) {
    prepRepo = new HttpRepository(base, getPwaAuthSession(), undefined, PREP_READ_TIMEOUT_MS);
  }
  return prepRepo;
}

export function resetPwaApi(): void {
  repo = null;
  prepRepo = null;
}
