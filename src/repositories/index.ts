export { productRepository, ProductRepository } from "./productRepository";
export { customerRepository, CustomerRepository } from "./customerRepository";
export { supplierRepository, SupplierRepository } from "./supplierRepository";
export type { SupplierSurtirHistoryItem } from "./supplierRepository";
export { inventoryRepository, InventoryRepository, weightedAvgCost } from "./inventoryRepository";
export { saleRepository, SaleRepository } from "./saleRepository";
export { cashRepository, CashRepository } from "./cashRepository";
export { assertDayEditable } from "./dayGuard";
export {
  metricVentas,
  metricRecibido,
  metricFiadoOutstanding,
  metricCaja,
  metricStockTotal,
  metricStockByProduct,
} from "./metrics";
export { loadStats, statsRepository } from "./statsRepository";
export type { StatsSnapshot } from "./statsRepository";
export type {
  DexieEntityId,
  Fase6AuthOps,
  Fase6CashOps,
  Fase6CatalogOps,
  Fase6SalesOps,
  RemoteEntityId,
} from "./ports";
