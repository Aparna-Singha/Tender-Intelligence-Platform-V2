import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it } from "vitest";

import { ApiResponseInterceptor } from "../src/common/api-response.interceptor.js";

describe("ApiResponseInterceptor", () => {
  it("wraps controller data with the active request ID", async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ id: "request-123" }),
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler<{ readonly status: "ok" }> = {
      handle: () => of({ status: "ok" }),
    };

    const result = await firstValueFrom(
      new ApiResponseInterceptor().intercept(context, next),
    );

    expect(result).toEqual({
      data: { status: "ok" },
      request_id: "request-123",
    });
  });
});
