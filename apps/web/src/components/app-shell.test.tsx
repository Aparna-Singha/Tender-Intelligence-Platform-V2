import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

const { apiRequest, pathnameState, searchState, routerState } = vi.hoisted(
  () => ({
    apiRequest: vi.fn(),
    pathnameState: { current: "/assistant/org-1" },
    routerState: {
      push: vi.fn(),
      refresh: vi.fn(),
      replace: vi.fn(),
    },
    searchState: { current: "" },
  }),
);

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.current,
  useRouter: () => routerState,
  useSearchParams: () => new URLSearchParams(searchState.current),
}));
vi.mock("../lib/api", () => ({
  apiRequest,
  PublicApiError: class PublicApiError extends Error {
    public constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  },
}));

const tenderFixtures = [
  {
    buyer: "Karnataka Municipal Technology Authority",
    id: "tender-1",
    isDemonstration: false,
    lifecycleStatus: "SOURCE_READY",
    sourceTenderNumber: "GEM/2026/B/TEST-1048",
    submissionDeadline: "2026-09-30T12:30:00.000Z",
    title:
      "AI-Enabled Municipal Video Analytics System - Supply, Installation and 3-Year Support",
    workflowState: {
      actionLabel: "Open",
      code: "DRAFTING",
      detail: "Drafting is available for the current version.",
      isCompleted: false,
      isDraft: true,
      isInProgress: false,
      needsAttention: false,
      onHold: false,
      statusLabel: "Preparing draft...",
      tone: "accent",
    },
    workspace: {
      processingProgress: 100,
      status: "READY",
    },
  },
  {
    buyer: "Municipal Corporation Mysuru",
    id: "tender-2",
    isDemonstration: false,
    lifecycleStatus: "SOURCE_READY",
    sourceTenderNumber: "GEM/2026/B/TEST-2049",
    submissionDeadline: "2026-10-04T12:30:00.000Z",
    title: "Urban CCTV operations and analytics support",
    workflowState: {
      actionLabel: "Open",
      code: "ANALYSIS_READY",
      detail: "Analysis ready for review.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Review tender",
      tone: "warning",
    },
    workspace: {
      processingProgress: 100,
      status: "READY",
    },
  },
] as const;

describe("app shell assistant and sidebar semantics", () => {
  beforeEach(() => {
    pathnameState.current = "/assistant/org-1";
    searchState.current = "";
    apiRequest.mockReset();
    routerState.push.mockReset();
    routerState.refresh.mockReset();
    routerState.replace.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") {
        return Promise.resolve({
          active_organisation_id: "org-1",
          user: { display_name: "Aparna", email: "aparna@example.test" },
        });
      }
      if (path === "/organisations") {
        return Promise.resolve([
          {
            organisation: {
              id: "org-1",
              name: "Tender Ops",
              type: "MSME",
            },
            role: "OWNER",
          },
        ]);
      }
      if (path === "/organisations/org-1/tenders") {
        return Promise.resolve(tenderFixtures);
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  it("ignores an older organisation response after switching", async () => {
    pathnameState.current = "/dashboard";
    let activeOrganisation = "org-1";
    let releaseOld!: (value: typeof tenderFixtures) => void;
    const oldTenders = new Promise<typeof tenderFixtures>((resolve) => {
      releaseOld = resolve;
    });
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session")
        return Promise.resolve({
          active_organisation_id: activeOrganisation,
          user: { display_name: "Aparna", email: "aparna@example.test" },
        });
      if (path === "/organisations")
        return Promise.resolve([
          {
            organisation: { id: "org-1", name: "First", type: "MSME" },
            role: "OWNER",
          },
          {
            organisation: { id: "org-2", name: "Second", type: "MSME" },
            role: "OWNER",
          },
        ]);
      if (path === "/organisations/org-1/tenders") return oldTenders;
      if (path === "/organisations/org-2/tenders")
        return Promise.resolve([
          {
            ...tenderFixtures[0],
            id: "second-tender",
            title: "Second organisation tender",
          },
        ]);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(
      <AppShell>
        <div>Dashboard content</div>
      </AppShell>,
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/organisations/org-1/tenders"),
    );
    activeOrganisation = "org-2";
    act(() => {
      window.dispatchEvent(new Event("organisation-changed"));
    });
    expect(
      (await screen.findAllByText("Second organisation tender")).length,
    ).toBeGreaterThan(0);
    act(() => {
      releaseOld(tenderFixtures);
    });
    expect(screen.queryAllByText(tenderFixtures[0].title)).toHaveLength(0);
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it("shows AI Chat as a primary destination and keeps tender chat shortcuts tender-scoped", async () => {
    render(
      <AppShell>
        <div>Child content</div>
      </AppShell>,
    );

    expect(
      await screen.findByRole("link", { name: "AI Chat" }),
    ).toHaveAttribute("href", "/assistant/org-1");

    expect(screen.getByRole("link", { name: "Company Docs" })).toHaveAttribute(
      "href",
      "/documents/org-1",
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(
      screen.getByRole("menuitem", { name: "Company profile" }),
    ).toHaveAttribute("href", "/onboarding/org-1");
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(routerState.push).toHaveBeenCalledWith(
      "/settings/org-1?section=organisation",
    );
    await user.click(
      screen.getByRole("button", {
        name: `Actions for ${tenderFixtures[0].title}`,
      }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Tender chat" }),
    ).toHaveAttribute("href", "/tenders/org-1/tender-1?stage=ask");
    expect(
      screen.getByRole("menuitem", { name: "Continue draft" }),
    ).toHaveAttribute("href", "/tenders/org-1/tender-1?stage=draft");
  });

  it("keeps the draft shortcut scoped to its tender and marks the active draft route", async () => {
    pathnameState.current = "/tenders/org-1/tender-1";
    searchState.current = "stage=draft";

    render(
      <AppShell>
        <div>Child content</div>
      </AppShell>,
    );

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: `Actions for ${tenderFixtures[0].title}`,
      }),
    );
    const draftLink = screen.getByRole("menuitem", { name: "Continue draft" });
    expect(draftLink).toHaveAttribute(
      "href",
      "/tenders/org-1/tender-1?stage=draft",
    );
    expect(draftLink).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Preparing draft...")).not.toBeInTheDocument();
  });

  it("uses an explicit Overview stage for Recent Tender links", async () => {
    render(
      <AppShell>
        <div>Child content</div>
      </AppShell>,
    );

    expect(
      await screen.findByRole("link", { name: tenderFixtures[0].title }),
    ).toHaveAttribute("href", "/tenders/org-1/tender-1?stage=overview");
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: `Actions for ${tenderFixtures[1].title}`,
      }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Tender chat" }),
    ).toHaveAttribute("href", "/tenders/org-1/tender-2?stage=ask");
    expect(
      screen.queryByRole("menuitem", { name: "Continue draft" }),
    ).not.toBeInTheDocument();
  });
});
