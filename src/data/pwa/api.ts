import { apiBaseUrl } from "../backend";
import { HttpRepository } from "../http/repository";
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

export function resetPwaApi(): void {
  repo = null;
}
