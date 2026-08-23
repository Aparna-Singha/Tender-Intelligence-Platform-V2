import { render, screen, within } from "@testing-library/react";
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

  it("shows a distinct AI Assistant item under Chats and does not relabel the first tender as Ask tender", async () => {
    render(
      <AppShell>
        <div>Child content</div>
      </AppShell>,
    );

    const chatsSection = await screen.findByRole("heading", { name: "Chats" });
    const chats = within(chatsSection.closest("section")!);

    expect(chats.getByRole("link", { name: /AI Assistant/ })).toHaveAttribute(
      "href",
      "/assistant/org-1",
    );
    expect(chats.getAllByText("Tender chat")).toHaveLength(2);
    expect(chats.queryByText("Ask tender")).not.toBeInTheDocument();
    expect(
      chats.getByRole("link", { name: /AI Assistant/ }).className,
    ).toContain("workspace-sidebar__chat-link--active");
  });

  it("renders Recent Drafts with title-only copy and highlights the active draft route", async () => {
    pathnameState.current = "/tenders/org-1/tender-1";
    searchState.current = "stage=draft";

    render(
      <AppShell>
        <div>Child content</div>
      </AppShell>,
    );

    const draftsHeading = await screen.findByRole("heading", {
      name: "Recent Drafts",
    });
    const draftsSection = draftsHeading.closest("section");
    expect(draftsSection).not.toBeNull();
    const drafts = within(draftsSection!);

    const draftLink = drafts.getByRole("link", {
      name: "AI-Enabled Municipal Video Analytics System - Supply, Installation and 3-Year Support",
    });
    expect(draftLink).toHaveAttribute(
      "href",
      "/tenders/org-1/tender-1?stage=draft",
    );
    expect(draftLink.className).toContain(
      "workspace-sidebar__quick-link--active",
    );
    expect(drafts.queryByText("Preparing draft...")).not.toBeInTheDocument();
  });
});
