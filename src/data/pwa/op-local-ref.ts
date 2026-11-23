import { getOutboxStore } from "../local/outbox";
import { localRef } from "./local-ref";

/** C09-PR6 — «L-AAMMDD-XXXX» of an op still on this device (same as the Sincronización tray). */
export async function localRefForOperation(businessId: string, operationId: string): Promise<string> {
  const op = await getOutboxStore().get(businessId, operationId).catch(() => undefined);
  return localRef(operationId, op?.localCreatedAt ?? Date.now());
}
