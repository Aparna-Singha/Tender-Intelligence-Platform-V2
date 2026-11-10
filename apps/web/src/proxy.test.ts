import { NextRequest, type NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

describe("synthetic preview route boundary", () => {
  it("blocks real application routes while allowing synthetic pages and the gated API", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("BIDVEDA_VISUAL_PREVIEW", "true");
    const responseFor = (path: string): NextResponse =>
      proxy(new NextRequest(`https://example.invalid${path}`));
    expect(responseFor("/dashboard").status).toBe(404);
    expect(responseFor("/login").status).toBe(404);
    expect(responseFor("/tenders/org/tender").status).toBe(404);
    expect(responseFor("/dashboard").headers.get("cache-control")).toBe(
      "no-store",
    );
    expect(responseFor("/visual-preview/dashboard").status).toBe(200);
    expect(responseFor("/visual-preview/evidence").status).toBe(200);
    expect(responseFor("/api/health").status).toBe(200);
  });

  it("leaves normal production routes available", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BIDVEDA_VISUAL_PREVIEW", "true");
    expect(proxy(new NextRequest("https://example.invalid/login")).status).toBe(
      200,
    );
  });
});
