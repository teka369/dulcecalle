export const ERROR_CODES = {
  VALIDATION: "VALIDATION",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CLOSED_DAY: "CLOSED_DAY",
  SESSION_ALREADY_CLOSED: "SESSION_ALREADY_CLOSED",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  ABONO_EXCEEDS_DEBT: "ABONO_EXCEEDS_DEBT",
  RETURN_EXCEEDS: "RETURN_EXCEEDS",
  NEED_COST: "NEED_COST",
  STOCK_VIA_MOVES: "STOCK_VIA_MOVES",
  RATE_LIMIT: "RATE_LIMIT",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const HTTP_FOR_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CLOSED_DAY: 409,
  SESSION_ALREADY_CLOSED: 409,
  INSUFFICIENT_STOCK: 409,
  ABONO_EXCEEDS_DEBT: 409,
  RETURN_EXCEEDS: 409,
  NEED_COST: 409,
  STOCK_VIA_MOVES: 409,
  RATE_LIMIT: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = HTTP_FOR_CODE[code],
  ) {
    super(message);
  }
}

export const MESSAGES = {
  needCost: "Si hay stock, ponle lo que te costó.",
  insufficientStock: "No hay suficiente stock.",
  closedDay: "No se puede editar el día.",
  sessionAlreadyClosed: "El día está cerrado.",
  abonoExceeds: "El abono no puede ser mayor al saldo.",
  returnExceeds: "No se puede devolver más de lo vendido.",
  returnEmpty: "Elige qué se devuelve.",
  returnLineNotFound: "Ese producto no está en la venta.",
  stockViaMoves:
    "El stock solo cambia con surtir, ventas, mermas, devoluciones o el alta inicial.",
  emptySale: "Agrega al menos un producto.",
  badQty: "La cantidad tiene que ser mayor a 0.",
  badPrice: "El precio tiene que ser 0 o más.",
  emptyName: "Ponle un nombre para guardarlo.",
  noMethod: "Elige Efectivo o Nequi.",
  unauthorized: "Inicia sesión.",
  forbidden: "No tienes permiso.",
  notFound: "No encontramos eso.",
  giftedNote: "Me lo regalaron / costo desconocido",
} as const;
