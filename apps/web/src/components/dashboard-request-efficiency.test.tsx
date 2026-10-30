import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "../lib/api";
import { AppShell } from "./app-shell";
import { Dashboard } from "./dashboard";

const { router } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

describe("dashboard and shell request counts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCsrfToken();
  });

  it("shares concurrent session, membership and tender-list reads", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      await Promise.resolve();
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/auth/session")
        return Response.json({
          data: {
            active_organisation_id: "org-1",
            user: { display_name: "Aparna", email: "aparna@example.test" },
          },
        });
      if (path === "/organisations")
        return Response.json({
          data: [
            {
              organisation: { id: "org-1", name: "Tender Ops", type: "MSME" },
              role: "OWNER",
            },
          ],
        });
      if (path === "/organisations/org-1/tenders")
        return Response.json({ data: [] });
      if (path === "/organisations/org-1/dashboard-recommendations")
        return Response.json({
          data: {
            completeness: {
              completed: 0,
              missingFields: [],
              percentage: 0,
              total: 8,
            },
            display_mode: "BEGINNER",
            progress: {
              completed_steps: [],
              current_step: 1,
              status: "NOT_STARTED",
            },
            recommendations: [],
          },
        });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell>
        <Dashboard />
      </AppShell>,
    );
    expect(
      await screen.findByRole("heading", { name: "Welcome back, Aparna." }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        calls.filter((path) => path === "/organisations/org-1/tenders"),
      ).toHaveLength(1),
    );
    expect(calls).toHaveLength(4);
    expect(new Set(calls).size).toBe(4);
    expect(calls.filter((path) => path === "/auth/session")).toHaveLength(1);
    expect(calls.filter((path) => path === "/organisations")).toHaveLength(1);
  });
});
