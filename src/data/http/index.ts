export { HttpClient } from "./client";
export { HttpSession } from "./session";
export { HttpRepository, createHttpRepository } from "./repository";
export type { CreateProductInput, CreateSaleInput, PatchProductInput } from "./repository";
export {
  mapProduct,
  mapCustomer,
  mapSale,
  mapPayment,
  mapSession,
  mapToday,
  asCopJson,
  asDateKey,
  asIsoEpoch,
} from "./mappers";
export type {
  RemoteProduct,
  RemoteCustomer,
  RemoteSale,
  RemotePayment,
  RemoteSession,
  RemoteToday,
} from "./mappers";
