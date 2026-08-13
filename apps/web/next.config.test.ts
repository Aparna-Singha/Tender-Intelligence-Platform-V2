import { describe, expect, it } from "vitest";

describe("web security headers", () => {
  it("uses a bounded production CSP without wildcard or eval script sources", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:3001";
    const { contentSecurityPolicy } = await import("./next.config");

    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).not.toContain("default-src *");
    expect(contentSecurityPolicy).not.toContain("script-src *");
    expect(contentSecurityPolicy).not.toContain("'unsafe-eval'");
  });

  it("applies security headers to all web routes", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:3001";
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
});
