import { afterEach, describe, expect, it, vi } from "vitest";

const { proxyApiRequest } = vi.hoisted(() => ({ proxyApiRequest: vi.fn() }));
vi.mock("../../lib/api-proxy.server", () => ({ proxyApiRequest }));

import { GET, POST } from "./[[...path]]/route";

describe("visual preview API gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    proxyApiRequest.mockReset();
  });

  it("denies reads and writes before proxying in a marked Vercel preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("BIDVEDA_VISUAL_PREVIEW", "true");
    for (const handle of [GET, POST]) {
      const response = await handle(
        new Request("https://demo.invalid/api/auth/session"),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(proxyApiRequest).not.toHaveBeenCalled();
  });

  it("does not apply preview mode in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BIDVEDA_VISUAL_PREVIEW", "true");
    expect(process.env.VERCEL_ENV).toBe("production");
    proxyApiRequest.mockResolvedValue(new Response(null, { status: 204 }));
    expect(
      (await GET(new Request("https://demo.invalid/api/health"))).status,
    ).toBe(204);
    expect(proxyApiRequest).toHaveBeenCalledOnce();
  });
});
