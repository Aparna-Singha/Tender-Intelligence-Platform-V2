import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./dashboard";

const { apiRequest, router } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  router: { push: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

describe("dashboard organisation flow", () => {
  beforeEach(() => {
    let created = false;
    apiRequest.mockReset();

    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/organisations" && init?.method === "POST") {
        created = true;
        return Promise.resolve({ id: "org-1" });
      }

      if (path === "/auth/session")
        return Promise.resolve({
          active_organisation_id: created ? "org-1" : null,
          user: { display_name: "Dinesh" },
        });

      if (path === "/organisations")
        return Promise.resolve(
          created
            ? [
                {
                  organisation: {
                    id: "org-1",
                    name: "Acme Works",
                    type: "MSME",
                  },
                  role: "OWNER",
                },
              ]
            : [],
        );

      if (path.endsWith("/dashboard-recommendations"))
        return Promise.resolve({
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
        });

      if (path.endsWith("/documents") || path.endsWith("/tenders"))
        return Promise.resolve([]);

      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  it("keeps a late prior-organisation tender response out of the dashboard", async () => {
    let activeOrganisation = "org-1";
    let releaseOld!: (value: unknown) => void;
    const oldTenders = new Promise((resolve) => {
      releaseOld = resolve;
    });
    const guidance = { recommendations: [] };
    const tender = (id: string, title: string): Record<string, unknown> => ({
      buyer: "Synthetic buyer",
      id,
      isDemonstration: false,
      lifecycleStatus: "SOURCE_READY",
      sourceTenderNumber: id,
      submissionDeadline: "2026-11-20T11:30:00.000Z",
      title,
      workflowState: {
        actionLabel: "Review",
        code: "ANALYSIS_READY",
        detail: "Review required.",
        isCompleted: false,
        isDraft: false,
        isInProgress: false,
        needsAttention: true,
        onHold: false,
        statusLabel: "Review tender",
        tone: "warning",
      },
      workspace: { processingProgress: 100, status: "READY" },
    });
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session")
        return Promise.resolve({
          active_organisation_id: activeOrganisation,
          user: { display_name: "Dinesh" },
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
      if (path.endsWith("/dashboard-recommendations"))
        return Promise.resolve(guidance);
      if (path === "/organisations/org-1/tenders") return oldTenders;
      if (path === "/organisations/org-2/tenders")
        return Promise.resolve([tender("new", "Second organisation tender")]);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<Dashboard />);
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
      releaseOld([tender("old", "First organisation tender")]);
    });
    expect(screen.queryAllByText("First organisation tender")).toHaveLength(0);
  });

  it("shows a recoverable API error instead of fabricated zero metrics", async () => {
    apiRequest.mockRejectedValueOnce(new Error("Unavailable"));
    render(<Dashboard />);
    expect(
      await screen.findByText("Workspace unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Workspace summary" }),
    ).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Welcome back, Dinesh." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Workspace unavailable")).not.toBeInTheDocument();
  });

  it("shows the empty state and creates an organisation without a stale form reference", async () => {
    const user = userEvent.setup();

    render(<Dashboard />);

    expect(
      await screen.findByRole("heading", {
        name: "Welcome back, Dinesh.",
      }),
    ).toBeInTheDocument();
    const initialSessionReads = apiRequest.mock.calls.filter(
      ([path]) => path === "/auth/session",
    ).length;

    await user.click(
      screen.getAllByRole("button", { name: /Create organisation/ })[0]!,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Create organisation",
    });

    await user.type(
      within(dialog).getByLabelText(/Organisation name/),
      "Acme Works",
    );

    await user.click(
      within(dialog).getByRole("button", {
        name: "Create organisation",
      }),
    );

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    await user.click(
      (
        await screen.findAllByRole("button", { name: "Analyse new tender" })
      )[0]!,
    );
    expect(router.push).toHaveBeenCalledWith("/tenders/org-1");
    expect(
      apiRequest.mock.calls.filter(([path]) => path === "/auth/session").length,
    ).toBe(initialSessionReads + 1);
    expect(
      apiRequest.mock.calls.filter(([path]) =>
        String(path).endsWith("/dashboard-recommendations"),
      ),
    ).toHaveLength(1);

    expect(
      screen.queryByRole("dialog", { name: "Create organisation" }),
    ).not.toBeInTheDocument();
  });
});

describe("dashboard home parity behavior", () => {
  beforeEach(() => {
    apiRequest.mockReset();

    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") {
        return Promise.resolve({
          active_organisation_id: "org-1",
          user: { display_name: "Dinesh" },
        });
      }

      if (path === "/organisations") {
        return Promise.resolve([
          {
            organisation: {
              id: "org-1",
              name: "Acme Works",
              type: "MSME",
            },
            role: "OWNER",
          },
        ]);
      }

      if (path === "/organisations/org-1/dashboard-recommendations") {
        return Promise.resolve({
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
          recommendations: [
            {
              action: "Update MSME registration details.",
              id: "rec-1",
              priority: "HIGH",
            },
            {
              action: "Add the latest GST certificate.",
              id: "rec-2",
              priority: "MEDIUM",
            },
          ],
        });
      }

      if (path === "/organisations/org-1/tenders") {
        return Promise.resolve([
          {
            buyer: "Zila Parishad Ajmer",
            id: "tender-1",
            isDemonstration: false,
            lifecycleStatus: "SOURCE_READY",
            sourceTenderNumber: "T-001",
            submissionDeadline: "2026-08-29T11:30:00.000Z",
            title: "School Furniture - Ajmer",
            workflowState: {
              actionLabel: "Continue",
              code: "ANALYSIS_READY",
              detail: "Risk summary available for review.",
              isCompleted: false,
              isDraft: false,
              isInProgress: false,
              needsAttention: true,
              onHold: false,
              statusLabel: "Needs review",
              tone: "warning",
            },
            workspace: {
              processingProgress: 0,
              status: "READY",
            },
          },
          {
            buyer: "Municipal Corporation Kota",
            id: "tender-2",
            isDemonstration: false,
            lifecycleStatus: "SOURCE_READY",
            sourceTenderNumber: "T-002",
            submissionDeadline: "2026-08-20T11:30:00.000Z",
            title: "Water Pipeline Works - Kota",
            workflowState: {
              actionLabel: "Review",
              code: "FAILED_RECOVERABLE",
              detail: "Upload needs attention.",
              isCompleted: false,
              isDraft: false,
              isInProgress: false,
              needsAttention: true,
              onHold: false,
              statusLabel: "Needs attention",
              tone: "danger",
            },
            workspace: {
              processingProgress: 0,
              status: "FAILED",
            },
          },
        ]);
      }

      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  it("shows real deadlines, attention counts, filters and an honest empty processing state", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
    });
    vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));

    try {
      render(<Dashboard />);

      expect(
        await screen.findByRole("heading", {
          name: "Welcome back, Dinesh.",
        }),
      ).toBeInTheDocument();

      expect(screen.getAllByText("3 days left")).toHaveLength(1);
      expect(screen.getAllByText("6 days overdue")).toHaveLength(1);

      expect(
        screen.queryByText(
          "Highest-value items surfaced from current tender and organisation state.",
        ),
      ).not.toBeInTheDocument();

      expect(
        screen.queryByText(
          "Use Home as a work queue across active tender workspaces.",
        ),
      ).not.toBeInTheDocument();

      expect(
        screen.queryByText(
          "Shown only when the backend exposes real running work.",
        ),
      ).not.toBeInTheDocument();

      expect(
        screen.queryByText("Active work that is still processing."),
      ).not.toBeInTheDocument();

      const summaryGrid = screen.getByRole("group", {
        name: "Workspace summary",
      });

      expect(within(summaryGrid).getByText("4")).toBeInTheDocument();

      const attentionHeading = screen.getByRole("heading", {
        name: "Needs attention",
      });

      const attentionSection = attentionHeading.closest("section");

      expect(attentionSection).not.toBeNull();

      expect(within(attentionSection!).getAllByRole("button")).toHaveLength(4);

      const tendersHeading = screen.getByRole("heading", {
        name: "Your tenders",
      });

      const tendersSection = tendersHeading.closest("section");

      expect(tendersSection).not.toBeNull();

      expect(
        within(tendersSection!).getByRole("button", {
          name: "All 2",
        }),
      ).toBeInTheDocument();

      expect(
        within(tendersSection!).getByRole("button", {
          name: "Active 2",
        }),
      ).toBeInTheDocument();

      expect(
        within(tendersSection!).getByRole("button", {
          name: "Completed 0",
        }),
      ).toBeInTheDocument();

      expect(
        within(tendersSection!).getByRole("button", {
          name: "In progress 0",
        }),
      ).toBeInTheDocument();

      expect(
        within(tendersSection!).getByText("Needs review"),
      ).toBeInTheDocument();
      expect(
        within(tendersSection!).getByText("Needs attention"),
      ).toBeInTheDocument();
      expect(
        within(tendersSection!).queryByText(
          "Risk summary available for review.",
        ),
      ).toBeInTheDocument();
      expect(
        within(tendersSection!).queryByText("Upload needs attention."),
      ).toBeInTheDocument();

      expect(
        screen.queryByRole("heading", {
          name: "In progress",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Nothing processing right now"),
      ).toBeInTheDocument();

      expect(
        screen.queryByText("No background processing is currently running."),
      ).not.toBeInTheDocument();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Ask about my workspace" }));
      expect(
        screen.getByRole("link", { name: "Open in AI Chat" }),
      ).toHaveAttribute("href", "/assistant/org-1?conversation=new");
      expect(
        screen
          .getByRole("link", { name: "Open in AI Chat" })
          .getAttribute("href"),
      ).not.toContain("stage=ask");
    } finally {
      vi.useRealTimers();
    }
  });
});
