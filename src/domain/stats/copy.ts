/**
 * S5 Estadísticas — LOCK FINAL RESUELTO.
 * Metrics SEPARATE — never one mixed total.
 * NO Esperado/Contado/Diferencia in Stats (Ir a Caja = link only).
 * NO Top productos / Movimientos. NO Vendí/Recibí/Me deben.
 */

export const STATS_COPY = {
  masItem: "Estadísticas",
  title: "Estadísticas",
  subtitle: "DulceCalle",

  periodHoy: "Hoy",
  periodSemana: "Semana",
  periodMes: "Mes",

  ventas: "Ventas",
  recibido: "Recibido",
  porCobrar: "Por cobrar",
  gaste: "Gasté",
  inverti: "Invertí",
  inventario: "Inventario",
  valorInventario: "Valor inventario",
  stockBajo: "Stock bajo",
  ganancia: "Ganancia aprox",

  efectivo: "Efectivo",
  nequi: "Nequi",
  nVentas: (n: number) => (n === 1 ? "1 venta" : `${n} ventas`),

  captionVentas: "Lo que facturaste. No es plata en mano.",
  captionRecibido: "Plata que sí entró. No es ganancia.",
  captionPorCobrar: "Lo que te deben.",
  captionGaste: "Gastos del negocio. No incluye retiros personales.",
  captionInverti: "Compras / surtir (inversión en inventario).",
  captionInventario: "A costo, no a precio de venta.",
  captionGanancia: "Venta menos costo. No es caja.",

  irACaja: "Ir a Caja",
  verClientes: "Ver clientes",
  verInventario: "Ver inventario",

  emptyPeriodo: "Aún no hay movimiento en este período.",
  loading: "Cargando estadísticas…",
  loadingAria: "Cargando",
  errorLoad: "No pudimos cargar las estadísticas.",
  reintentar: "Reintentar",
} as const;

export type StatsPeriod = "hoy" | "semana" | "mes";
