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

  it("coalesces only concurrent shared reads and refetches after completion", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ data: { active_organisation_id: "org-a" } }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      apiRequest("/auth/session"),
      apiRequest("/auth/session"),
    ]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await apiRequest("/auth/session");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a shared read after an organisation mutation", async () => {
    let releaseSession!: (response: Response) => void;
    const sessionResponse = new Promise<Response>((resolve) => {
      releaseSession = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/auth/session")) return sessionResponse;
      if (url.endsWith("/auth/csrf"))
        return Promise.resolve(
          Response.json({ data: { csrf_token: "token" } }),
        );
      return Promise.resolve(Response.json({ data: { selected: true } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const oldSession = apiRequest("/auth/session");
    await apiRequest("/organisations/org-b/select", { method: "POST" });
    releaseSession(
      Response.json({ data: { active_organisation_id: "org-a" } }),
    );
    await expect(oldSession).rejects.toMatchObject({
      code: "STALE_RESPONSE",
    });
  });
});
