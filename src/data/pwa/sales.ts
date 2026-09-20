import { getPwaApi } from "./api";
import type { RemoteReturn, RemoteSale, RemoteSaleLine } from "../http/mappers";

export type HttpReturnableLine = RemoteSaleLine & {
  returnedQty: number;
  remaining: number;
};

export type HttpReturnable = {
  sale: RemoteSale;
  lines: HttpReturnableLine[];
  remainingValue: number;
  returns: RemoteReturn[];
};

export async function getHttpReturnable(
  saleId: string,
): Promise<HttpReturnable | null> {
  const api = getPwaApi();
  let sale: RemoteSale;
  try {
    sale = await api.sales.get(saleId);
  } catch {
    return null;
  }
  const returns = await api.sales.returns(saleId);
  const returned = new Map<string, number>();
  for (const r of returns) {
    for (const line of r.lines) {
      returned.set(line.saleLineId, (returned.get(line.saleLineId) ?? 0) + line.qty);
    }
  }
  const lines = sale.lines.map((l) => {
    const returnedQty = returned.get(l.id) ?? 0;
    return { ...l, returnedQty, remaining: l.qty - returnedQty };
  });
  const remainingValue = lines.reduce(
    (s, l) => s + l.unitPrice * l.remaining,
    0,
  );
  return { sale, lines, remainingValue, returns };
}
