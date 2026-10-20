import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { map, type Observable } from "rxjs";
import { PAGE_META, type PagedArray } from "./paging";

export const PAGING_HEADERS = ["X-Has-More", "X-Next-Cursor"];

/** Copies the PAGE_META tag of a paged list into response headers. */
@Injectable()
export class PagingHeadersInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        const meta = Array.isArray(body) ? (body as PagedArray<unknown>)[PAGE_META] : undefined;
        if (meta && ctx.getType() === "http") {
          const res = ctx.switchToHttp().getResponse<Response>();
          res.setHeader("X-Has-More", meta.hasMore ? "true" : "false");
          if (meta.nextCursor) res.setHeader("X-Next-Cursor", meta.nextCursor);
        }
        return body;
      }),
    );
  }
}
