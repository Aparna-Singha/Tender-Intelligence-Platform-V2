import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWorkspace } from "./settings-workspace";

const { apiRequest, searchParams } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  searchParams: new URLSearchParams("section=people-access"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/org-1",
  useSearchParams: () => searchParams,
}));

vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

function mockSettingsLoad(role: string): void {
  apiRequest.mockImplementation((path: string) => {
    if (path === "/organisations/org-1")
      return Promise.resolve({
        createdAt: "2026-08-01T00:00:00.000Z",
        id: "org-1",
        name: "Acme Works",
        type: "MSME",
      });
    if (path === "/organisations")
      return Promise.resolve([
        {
          organisation: { id: "org-1", name: "Acme Works", type: "MSME" },
          role,
        },
      ]);
    if (path === "/organisations/org-1/members")
      return Promise.resolve([
        {
          createdAt: "2026-08-01T00:00:00.000Z",
          id: "member-1",
          role: "OWNER",
          user: { displayName: "Owner User", email: "owner@example.com" },
        },
        {
          createdAt: "2026-08-02T00:00:00.000Z",
          id: "member-2",
          role: "REVIEWER",
          user: { displayName: "Reviewer User", email: "reviewer@example.com" },
        },
      ]);
    if (path === "/auth/session")
      return Promise.resolve({
        active_organisation_id: "org-1",
        user: {
          display_name: "Owner User",
          email: "owner@example.com",
          id: "user-1",
        },
      });
    if (path === "/auth/sessions") return Promise.resolve([]);
    if (path === "/organisations/org-1/onboarding")
      return Promise.resolve({
        display_mode: "PROFESSIONAL",
        progress: {
          completed_steps: [1, 2],
          current_step: 3,
          status: "IN_PROGRESS",
        },
        values: {},
      });
    return Promise.reject(new Error(`Unexpected request: ${path}`));
  });
}

describe("settings workspace", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    searchParams.set("section", "people-access");
  });

  it("shows invitation and role controls only when the current membership supports them", async () => {
    mockSettingsLoad("OWNER");
    render(<SettingsWorkspace organisationId="org-1" />);
    expect(
      await screen.findByRole("heading", { name: "People & access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send invitation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("falls back to honest unsupported messaging for non-admin roles", async () => {
    mockSettingsLoad("REVIEWER");
    render(<SettingsWorkspace organisationId="org-1" />);
    expect(
      await screen.findByText(/Invitation controls unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send invitation" }),
    ).not.toBeInTheDocument();
  });

  it("keeps preferences navigation URL-addressable from the company profile surface", async () => {
    searchParams.set("section", "organisation");
    mockSettingsLoad("OWNER");
    render(<SettingsWorkspace organisationId="org-1" />);
    expect(
      await screen.findByRole("heading", { name: "Company profile" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View preferences" }),
    ).toHaveAttribute("href", "/settings/org-1?section=preferences");
  });
});
