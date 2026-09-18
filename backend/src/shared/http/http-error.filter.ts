import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Response } from "express";
import { AppError, ERROR_CODES } from "../errors";

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("HttpError");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<{
      user?: { id?: string };
      business?: { businessId?: string };
      headers: Record<string, string | undefined>;
    }>();

    let status = 500;
    let code: string = ERROR_CODES.INTERNAL;
    let message = "Algo salió mal.";

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      code = ERROR_CODES.RATE_LIMIT;
      message = "Demasiadas solicitudes.";
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (status === 400) {
        code = ERROR_CODES.VALIDATION;
        message =
          typeof body === "object" && body && "message" in body
            ? Array.isArray((body as { message: unknown }).message)
              ? ((body as { message: string[] }).message[0] ?? "Datos inválidos.")
              : String((body as { message: unknown }).message)
            : "Datos inválidos.";
      } else if (status === 401) {
        code = ERROR_CODES.UNAUTHORIZED;
        message = "Inicia sesión.";
      } else if (status === 403) {
        code = ERROR_CODES.FORBIDDEN;
        message = "No tienes permiso.";
      } else if (status === 404) {
        code = ERROR_CODES.NOT_FOUND;
        message = "No encontramos eso.";
      } else {
        message = exception.message;
      }
    } else {
      this.log.error(exception);
    }

    this.log.log(
      JSON.stringify({
        op: req.headers?.["x-operation"] ?? "http",
        result: code,
        userId: req.user?.id ?? null,
        businessId: req.business?.businessId ?? null,
        requestId: req.headers?.["idempotency-key"] ?? null,
        status,
      }),
    );

    res.status(status).json({ error: { code, message } });
  }
}
