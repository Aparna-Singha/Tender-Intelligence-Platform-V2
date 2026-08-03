import { HttpException, HttpStatus, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ApiExceptionFilter } from "../src/common/api-exception.filter.js";
import { FinalReadinessError } from "../src/final-readiness/final-readiness.error.js";

interface MockHost {
  readonly error: ReturnType<typeof vi.fn>;
  readonly host: ArgumentsHost;
  readonly send: ReturnType<typeof vi.fn>;
  readonly status: ReturnType<typeof vi.fn>;
}

function createHost(): MockHost {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const error = vi.fn();
  const request = { id: "request-123", log: { error } };
  const reply = { status };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;

  return { error, host, send, status };
}

describe("ApiExceptionFilter", () => {
  it("returns the standard safe envelope for expected client errors", () => {
    const { host, send, status } = createHost();

    new ApiExceptionFilter().catch(
      new HttpException("private validation detail", HttpStatus.BAD_REQUEST),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(send).toHaveBeenCalledWith({
      error: {
        code: "BAD_REQUEST",
        message: "The request is invalid.",
      },
      request_id: "request-123",
    });
  });

  it("does not expose unexpected exception details", () => {
    const { error, host, send, status } = createHost();

    new ApiExceptionFilter().catch(new Error("database-password"), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(send).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
      request_id: "request-123",
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("database-password");
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain("database-password");
  });

  it("preserves a bounded final-readiness public code and request ID", () => {
    const { host, send, status } = createHost();

    new ApiExceptionFilter().catch(
      new FinalReadinessError(
        "FINAL_READINESS_RUN_STALE",
        "The final-readiness run is no longer current.",
        HttpStatus.CONFLICT,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(send).toHaveBeenCalledWith({
      error: {
        code: "FINAL_READINESS_RUN_STALE",
        message: "The final-readiness run is no longer current.",
      },
      request_id: "request-123",
    });
  });
});
