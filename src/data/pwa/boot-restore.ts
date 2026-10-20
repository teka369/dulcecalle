/**
 * Cold offline load of an entity URL: the service worker served the parent
 * list document (see sw-routing). The inline boot script in layout.tsx
 * records location.pathname in window.__DC_BOOT_PATH before hydration;
 * the shell then reopens the ficha from IndexedDB and puts the URL back.
 */
import { coldLoadParentPath, isGestionarCajaDetail, parseEntityHref } from "./entity-href";

export type BootRestore =
  | { kind: "entity"; path: string }
  | { kind: "server-only"; path: string };

export function bootRestoreTarget(bootPath: string | null | undefined, offline: boolean): BootRestore | null {
  if (!offline || !bootPath) return null;
  if (!coldLoadParentPath(bootPath)) return null;
  if (isGestionarCajaDetail(bootPath)) return { kind: "server-only", path: bootPath };
  if (parseEntityHref(bootPath)) return { kind: "entity", path: bootPath };
  return null;
}

export const BOOT_ENTITY_ATTR = "data-dc-boot-entity";

/** Inline, pre-hydration. Must stay self-contained (stringified into the page). */
export function bootScriptSource(entityPatterns: string[]): string {
  return `(function(){try{var p=location.pathname;window.__DC_BOOT_PATH=p;if(navigator.onLine)return;var r=${JSON.stringify(
    entityPatterns,
  )};for(var i=0;i<r.length;i++){if(new RegExp(r[i],"i").test(p)){document.documentElement.setAttribute(${JSON.stringify(
    BOOT_ENTITY_ATTR,
  )},"");return;}}}catch(e){}})();`;
}

declare global {
  interface Window {
    __DC_BOOT_PATH?: string;
  }
}
