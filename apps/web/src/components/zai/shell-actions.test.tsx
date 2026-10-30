import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";
import { AppShell } from "../app-shell";
const { apiRequest, router, clearCsrfToken } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  clearCsrfToken: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiRequest,
  clearCsrfToken,
}));
describe("source-design account controls", () => {
  let active = "org-1";
  let rejectMutation = false;
  beforeEach(() => {
    active = "org-1";
    rejectMutation = false;
    vi.clearAllMocks();
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        if (rejectMutation)
          return Promise.reject(new Error("Synthetic failure"));
        if (path.endsWith("/select")) active = "org-2";
        return Promise.resolve({});
      }
      if (path === "/auth/session")
        return Promise.resolve({
          active_organisation_id: active,
          user: { display_name: "Test User", email: "synthetic@example.test" },
        });
      if (path === "/organisations")
        return Promise.resolve(
          [1, 2].map((n) => ({
            organisation: {
              id: `org-${n}`,
              name: `Organisation ${n}`,
              type: "MSME",
            },
            role: "OWNER",
          })),
        );
      if (path.endsWith("/tenders")) return Promise.resolve([]);
      throw new Error("Unexpected test request");
    });
  });
  it.each([false, true])(
    "handles sign-out failure=%s without simulated success",
    async (failure) => {
      rejectMutation = failure;
      const user = userEvent.setup();
      render(
        <AppShell>
          <p>Content</p>
        </AppShell>,
      );
      await screen.findByText("Test User");
      await user.click(screen.getByRole("button", { name: "Account menu" }));
      await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
      expect(apiRequest).toHaveBeenCalledWith("/auth/logout", {
        method: "POST",
      });
      if (failure) {
        expect(
          await screen.findByText("Account action failed"),
        ).toBeInTheDocument();
        expect(router.replace).not.toHaveBeenCalled();
        expect(clearCsrfToken).not.toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(router.replace).toHaveBeenCalledWith("/login"),
        );
        expect(clearCsrfToken).toHaveBeenCalledTimes(1);
      }
    },
  );
  it.each([false, true])(
    "handles organisation selection failure=%s without crossing tenant context",
    async (failure) => {
      rejectMutation = failure;
      const user = userEvent.setup();
      render(
        <AppShell>
          <p>Content</p>
        </AppShell>,
      );
      await screen.findByText("Test User");
      await user.click(
        screen.getByRole("button", { name: "Current organisation" }),
      );
      await user.click(
        screen.getByRole("menuitem", { name: /Organisation 2/ }),
      );
      expect(apiRequest).toHaveBeenCalledWith("/organisations/org-2/select", {
        method: "POST",
      });
      if (failure) {
        expect(
          await screen.findByText("Account action failed"),
        ).toBeInTheDocument();
        expect(router.push).not.toHaveBeenCalled();
        expect(screen.getByRole("link", { name: "AI Chat" })).toHaveAttribute(
          "href",
          "/assistant/org-1",
        );
      } else {
        await waitFor(() =>
          expect(screen.getByRole("link", { name: "AI Chat" })).toHaveAttribute(
            "href",
            "/assistant/org-2",
          ),
        );
        expect(router.push).toHaveBeenCalledWith("/dashboard");
      }
    },
  );
});
