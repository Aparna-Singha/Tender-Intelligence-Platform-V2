import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicApiError,
  apiRequest,
  clearCsrfToken,
  formatApiError,
} from "./api";

describe("public API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCsrfToken();
  });
  it("surfaces safe status, code, message and request ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "FORBIDDEN", message: "Permission denied." },
            request_id: "req-safe-123",
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const error = await apiRequest("/private").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PublicApiError);
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      message: "Permission denied.",
      requestId: "req-safe-123",
      status: 403,
    });
    expect(formatApiError(error, "fallback")).toContain(
      "Request ID: req-safe-123",
    );
  });
  it("handles network and non-JSON failures without exposing internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("socket secret")),
    );
    await expect(apiRequest("/health")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("gateway html", { status: 502 })),
    );
    await expect(apiRequest("/health")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 502,
    });
  });
});
