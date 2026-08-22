import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./dashboard";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
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
  it("shows the empty state and creates an organisation without a stale form reference", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(
      await screen.findByRole("heading", {
        name: "Good morning, Dinesh",
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", { name: /Create organisation/ })[0]!,
    );
    const dialog = screen.getByRole("dialog", { name: "Create organisation" });
    await user.type(
      within(dialog).getByLabelText(/Organisation name/),
      "Acme Works",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create organisation" }),
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(
      await screen.findByRole("link", { name: /Analyse new tender/ }),
    ).toHaveAttribute("href", "/tenders/org-1");
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
          recommendations: [],
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

  it("shows deadline text, removes helper copy, and hides in-progress when no real work exists", async () => {
    render(<Dashboard />);

    expect(
      await screen.findByRole("heading", {
        name: "Good morning, Dinesh",
      }),
    ).toBeInTheDocument();

    expect(screen.getAllByText("7 days left")).toHaveLength(2);
    expect(screen.getAllByText("2 days overdue")).toHaveLength(2);

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

    const tendersHeading = screen.getByRole("heading", {
      name: "Your tenders",
    });
    const tendersSection = tendersHeading.closest("section");
    expect(tendersSection).not.toBeNull();
    expect(
      within(tendersSection!).getByRole("button", { name: "All 2" }),
    ).toBeInTheDocument();
    expect(
      within(tendersSection!).getByRole("button", { name: "Active 2" }),
    ).toBeInTheDocument();
    expect(
      within(tendersSection!).getByRole("button", { name: "Completed 0" }),
    ).toBeInTheDocument();
    expect(
      within(tendersSection!).getByRole("button", { name: "In progress 0" }),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("heading", { name: "In progress" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No background processing is currently running."),
    ).not.toBeInTheDocument();
  });
});
