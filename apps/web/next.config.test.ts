import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.NODE_ENV = "test";
  process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:3001";
  process.env.NEXT_PUBLIC_STORAGE_ORIGIN = "http://127.0.0.1:9000";
});

describe("web security headers", () => {
  it("uses a bounded production CSP without wildcard or eval script sources", async () => {
    const { contentSecurityPolicy } = await import("./next.config");

    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).not.toContain("default-src *");
    expect(contentSecurityPolicy).not.toContain("script-src *");
    expect(contentSecurityPolicy).not.toContain("'unsafe-eval'");
  });

  it("allows only the exact configured API and storage origins for browser connect-src", async () => {
    const { contentSecurityPolicy } = await import("./next.config");

    expect(contentSecurityPolicy).toContain(
      "connect-src 'self' http://127.0.0.1:3001 http://127.0.0.1:9000",
    );
    expect(contentSecurityPolicy).not.toContain("https://untrusted.example");
    expect(contentSecurityPolicy).not.toContain("connect-src *");
    expect(contentSecurityPolicy).not.toContain("https:");
  });

  it("applies security headers to all web routes", async () => {
    const { default: nextConfig, contentSecurityPolicy } =
      await import("./next.config");
    const headers = await nextConfig.headers?.();

    expect(headers).toEqual([
      expect.objectContaining({
        headers: expect.arrayContaining([
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ]),
        source: "/:path*",
      }),
    ]);
  });

  it("keeps development-only eval script support out of non-development builds", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();

    const { contentSecurityPolicy } = await import("./next.config");

    expect(contentSecurityPolicy).not.toContain("'unsafe-eval'");
  });
});
