import { isUuid, newEntityId, newRequestId } from "@/domain/requestId";

export { isUuid, newEntityId, newRequestId };

export function assertUuid(value: unknown, field = "id"): string {
  if (!isUuid(value)) {
    throw new Error(`${field} must be a UUID string`);
  }
  return value;
}
