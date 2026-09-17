/**
 * Exact Tanda 4 FINAL + Designer wires (LOCKED).
 * Gasto ≠ Retiro personal ≠ Aporte de capital ≠ Caja ≠ Cerrar caja ≠ Diferencia
 */

export const CASH_COPY = {
  // Nav Más
  masGastos: "Gastos",
  masCaja: "Caja",

  // Caja home
  titleCaja: "Caja",
  estadoAbierta: "Caja abierta",
  estadoCerrada: "Caja cerrada",
  estadoSinAbrir: "Sin abrir",
  abrirCajaHint: "Fondo con el que arrancas. No cuentes lo vendido hoy.",
  enCaja: "Efectivo + Nequi",
  entradas: "Entradas",
  salidas: "Salidas",
  emptyAbierta: "Aún no hay movimientos.",
  emptyCerrada: "Abre la caja para registrar movimientos.",
  abrirCaja: "Abrir caja",
  toastCajaAbierta: "Caja abierta",
  conCuantoAbres: "¿Con cuánto abres?",
  montoNoNegativo: "El monto no puede ser negativo.",
  registrarGasto: "Registrar gasto",
  retiroPersonal: "Retiro personal",
  aporteCapital: "Aporte de capital",
  cerrarCaja: "Cerrar caja",

  esperado: "Esperado",
  contado: "Contado",
  diferencia: "Diferencia",
  cuadra: "Cuadra",
  faltante: "Faltante",
  sobrante: "Sobrante",
  cuadraPerfecto: "Cuadra perfecto",
  cerrarConDiferencia: "¿Cerrar con diferencia?",
  confirmarCierre: "Confirmar cierre",
  toastCajaCerrada: "Caja cerrada",
  deberiaHaber: "Debería haber",
  cuantoHay: "¿Cuánto hay?",
  escribeContaste: "Escribe cuánto contaste.",
  revisaContado: "Revisa el monto contado.",
  sinDiferencia: "Sin diferencia",

  // Closed day blocks
  noSePuedeEditar: "No se puede editar el día.",
  elDiaEstaCerrado: "El día está cerrado.",

  // Inicio
  cajaEsperado: "Caja esperado",

  // Gasto
  gastoHelper: "Plata del negocio que sale para operar. No es retiro personal.",
  gastoCaption: "Esto es un gasto del negocio, no un retiro tuyo.",
  monto: "Monto",
  enQueSeGasto: "¿En qué se gastó?",
  comoPagaste: "¿Cómo pagaste?",
  nota: "Nota",
  confirmarGasto: "Confirmar gasto",
  toastGasto: "Gasto registrado",

  // Retiro
  retiroHelper: "Sale de la caja para uso personal. No cuenta como gasto del negocio.",
  retiroCaption: "Plata que tú sacas. No es un gasto.",
  comoRetiras: "¿Cómo retiras?",
  confirmarRetiro: "Confirmar retiro",
  toastRetiro: "Retiro registrado",

  // Aporte
  aporteHelper: "Entra plata tuya al negocio. No es una venta.",
  aporteCaption: "Plata que tú metes al negocio.",
  comoAportas: "¿Cómo aportas?",
  confirmarAporte: "Confirmar aporte",
  toastAporte: "Aporte registrado",
} as const;

export const CASH_ERRORS = {
  emptyAmount: "Escribe el monto.",
  notPositive: "El monto tiene que ser mayor a 0.",
  noMethod: "Elige Efectivo o Nequi.",
  emptyCategory: "Di en qué se gastó.",
  emptyCounted: "Escribe cuánto contaste.",
  badCounted: "Revisa el monto contado.",
  openingNegative: "El monto no puede ser negativo.",
  dayClosed: "No se puede editar el día.",
  dayClosedAlt: "El día está cerrado.",
  sessionAlreadyOpen: "Ya hay una caja abierta hoy.",
  sessionAlreadyClosed: "El día está cerrado.",
  noOpenSession: "Abre la caja para registrar movimientos.",
} as const;
