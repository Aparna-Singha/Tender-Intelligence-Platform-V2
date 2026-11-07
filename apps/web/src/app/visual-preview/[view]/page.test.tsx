import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("../../../components/visual-preview", () => ({
  VisualPreview: ({ view }: { view: string }) => <p>{view}</p>,
}));

import VisualPreviewPage from "./page";

describe("visual preview route gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is unavailable outside a marked preview deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BIDVEDA_VISUAL_PREVIEW", "true");
    await expect(
      VisualPreviewPage({ params: Promise.resolve({ view: "dashboard" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("accepts only the two synthetic views in preview mode", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("BIDVEDA_VISUAL_PREVIEW", "true");
    expect(
      await VisualPreviewPage({
        params: Promise.resolve({ view: "dashboard" }),
      }),
    ).toMatchObject({ props: { view: "dashboard" } });
    await expect(
      VisualPreviewPage({ params: Promise.resolve({ view: "private" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
