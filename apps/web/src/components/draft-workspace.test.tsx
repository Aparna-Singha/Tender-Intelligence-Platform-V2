import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicApiError } from "../lib/api";
import { DraftWorkspace } from "./draft-workspace";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  PublicApiError: class PublicApiError extends Error {
    public constructor(
      message: string,
      public readonly status: number,
      public readonly code: string,
    ) {
      super(message);
    }
  },
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

const source = readFileSync(
  resolve(process.cwd(), "src/components/draft-workspace.tsx"),
  "utf8",
);

function installApi(): void {
  apiRequest.mockImplementation((path: string) => {
    if (
      path ===
      "/organisations/org-1/tenders/tender-1/draft-templates?draft_type=CONSOLIDATED_FIRST_DRAFT"
    )
      return Promise.resolve([
        {
          activeVersionId: "template-version-1",
          id: "template-1",
          name: "Controlled consolidated first draft",
          versions: [{ id: "template-version-1", versionNumber: 1 }],
        },
      ]);
    if (path === "/organisations/org-1/tenders/tender-1/draft-generation-runs")
      return Promise.resolve([]);
    if (path === "/organisations/org-1/tenders/tender-1/drafts")
      return Promise.resolve([]);
    return Promise.reject(new Error(`Unexpected API call: ${path}`));
  });
}

describe("draft workspace safety", () => {
  it("measures stable draft-stage requests over 20 seconds", async () => {
    vi.useFakeTimers();
    try {
      const view = render(
        <DraftWorkspace organisationId="org-1" tenderId="tender-1" />,
      );
      for (let step = 0; step < 5; step += 1)
        await vi.advanceTimersByTimeAsync(0);
      const initial = apiRequest.mock.calls.length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect({
        initial,
        idle: apiRequest.mock.calls.length - initial,
      }).toEqual({ initial: 3, idle: 0 });
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      for (let step = 0; step < 5; step += 1)
        await vi.advanceTimersByTimeAsync(0);
      expect(apiRequest.mock.calls).toHaveLength(initial + 3);
      view.unmount();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(apiRequest.mock.calls).toHaveLength(initial + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls a queued draft until it reaches a terminal state", async () => {
    const defaultApi = apiRequest.getMockImplementation()!;
    let runReads = 0;
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/draft-generation-runs")) {
        runReads += 1;
        return Promise.resolve([
          {
            citationCount: 0,
            currentStage: runReads === 1 ? "Queued" : "Complete",
            draftId: null,
            id: "run-a",
            placeholderCount: 0,
            progressPercentage: runReads === 1 ? 0 : 100,
            safeFailureCode: null,
            sourceMode: "TENDER_ONLY",
            status: runReads === 1 ? "QUEUED" : "COMPLETE",
            title: "Synthetic draft",
            validatedClaimCount: 0,
          },
        ]);
      }
      return defaultApi(path) as unknown;
    });
    vi.useFakeTimers();
    try {
      const view = render(
        <DraftWorkspace organisationId="org-1" tenderId="tender-1" />,
      );
      for (let step = 0; step < 5; step += 1)
        await vi.advanceTimersByTimeAsync(0);
      expect(runReads).toBe(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(runReads).toBe(2);
      for (let step = 0; step < 5; step += 1)
        await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(runReads).toBe(2);
      view.unmount();
    } finally {
      vi.useRealTimers();
      apiRequest.mockImplementation(defaultApi);
    }
  });
  it("keeps draft action status visible in the readiness rail", () => {
    expect(source).toContain('className="draft-rail__status"');
  });

  beforeEach(() => {
    apiRequest.mockReset();
    installApi();
  });

  it("shows human-control and source limitations", () => {
    expect(source).toContain("Generated content requires human review");
    expect(source).toContain("does not determine legal");
  });

  it("shows citations, placeholders, history, and review controls", () => {
    expect(source).toContain("Version history");
    expect(source).toContain("Draft history");
    expect(source).toContain("Placeholders");
    expect(source).toContain("Request review");
    expect(source).toContain("Request changes");
    expect(source).toContain("Approve for final readiness review");
    expect(source).toContain("Review & Export");
    expect(source).toContain("Source scope");
    expect(source).not.toContain('aria-hidden="true"');
    expect(source).toContain("citation");
  });

  it("does not expose readiness, export, scraping, or submission actions", () => {
    expect(source).not.toContain("Run final readiness");
    expect(source).not.toContain("Export package");
    expect(source).not.toContain("Open Review & Export");
    expect(source).not.toContain("Scrape");
    expect(source).not.toContain("Submit bid");
  });

  it("keeps draft creation in the main workspace before a proposal exists", () => {
    expect(source).toContain("Create proposal draft");
    expect(source).toContain("Create another draft");
    expect(source).toContain("setShowCreationForm(true)");
    expect(source).toContain("Draft not started");
  });

  it("renders the dedicated draft header and workspace tabs", () => {
    expect(source).toContain('aria-label="Draft workspace tabs"');
    expect(source).toContain("Back to Overview");
    expect(source).toContain("draft-workspace-header");
    expect(source).toContain("Preview full draft");
    expect(source).toContain("Overall draft readiness");
    expect(source).not.toContain("AI suggestions");
    expect(source).not.toContain("Review status");
  });

  it("shows the draft form immediately and does not fire a mutation", async () => {
    render(<DraftWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("heading", { name: "Create proposal draft" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your proposal draft" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Draft workspace tabs" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Draft name")).toBeInTheDocument();
    expect(
      screen.getByText("Draft history").closest("details"),
    ).not.toHaveAttribute("open");
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it("enables creation when the existing controlled template is ready", async () => {
    render(<DraftWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("button", { name: "Create draft" }),
    ).toBeEnabled();
  });

  it("explains the actual template prerequisite when creation is disabled", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("draft-templates?draft_type=CONSOLIDATED_FIRST_DRAFT"))
        return Promise.resolve([]);
      if (path.endsWith("draft-generation-runs") || path.endsWith("/drafts"))
        return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
    const user = userEvent.setup();
    render(<DraftWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByText(
        "A controlled draft template is required before a proposal can be created.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Create controlled template" }),
    );
    expect(apiRequest).toHaveBeenCalledWith(
      "/organisations/org-1/tenders/tender-1/draft-templates",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps provider failures safe and actionable without a request ID", async () => {
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (
        path ===
        "/organisations/org-1/tenders/tender-1/draft-templates?draft_type=CONSOLIDATED_FIRST_DRAFT"
      )
        return Promise.resolve([
          {
            activeVersionId: "template-version-1",
            id: "template-1",
            name: "Controlled consolidated first draft",
            versions: [{ id: "template-version-1", versionNumber: 1 }],
          },
        ]);
      if (path.endsWith("draft-generation-runs") && init?.method === "POST")
        return Promise.reject(
          new PublicApiError(
            "Request ID: internal-123",
            503,
            "SERVICE_UNAVAILABLE",
          ),
        );
      if (path.endsWith("draft-generation-runs") || path.endsWith("/drafts"))
        return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
    const user = userEvent.setup();
    render(<DraftWorkspace organisationId="org-1" tenderId="tender-1" />);

    await user.type(await screen.findByLabelText("Draft name"), "First draft");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(
      await screen.findByRole("heading", {
        name: "Draft generation is temporarily unavailable.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your tender and review work are safe. Try again once the drafting service is available.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Request ID/)).not.toBeInTheDocument();
  });

  it("identifies dependency failures as temporary and retries the failed run", async () => {
    let retryRequest: (() => void) | undefined;
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("draft-templates?draft_type=CONSOLIDATED_FIRST_DRAFT"))
        return Promise.resolve([
          {
            activeVersionId: "template-version-1",
            id: "template-1",
            name: "Controlled consolidated first draft",
            versions: [{ id: "template-version-1", versionNumber: 1 }],
          },
        ]);
      if (path.endsWith("draft-generation-runs/failed-run/retry"))
        return new Promise((resolve) => {
          retryRequest = () =>
            resolve({
              id: "retry-run",
              safeFailureCode: null,
              sourceMode: "TENDER_ONLY",
              status: "QUEUED",
              title: "Proposal draft",
            });
        });
      if (path.endsWith("draft-generation-runs") && init?.method !== "POST")
        return Promise.resolve([
          {
            id: "failed-run",
            safeFailureCode: "PROVIDER_DEPENDENCY_UNAVAILABLE",
            sourceMode: "TENDER_ONLY",
            status: "FAILED",
            title: "Proposal draft",
          },
        ]);
      if (path.endsWith("/drafts")) return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
    const user = userEvent.setup();
    render(<DraftWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("heading", {
        name: "Draft generation is temporarily unavailable.",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Retrying...").closest("button")).toBeDisabled();
    retryRequest?.();
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/tenders/tender-1/draft-generation-runs/failed-run/retry",
        { method: "POST" },
      ),
    );
  });

  it("starts from current inputs when an old failed snapshot cannot be retried", async () => {
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("draft-templates?draft_type=CONSOLIDATED_FIRST_DRAFT"))
        return Promise.resolve([
          {
            activeVersionId: "template-version-1",
            id: "template-1",
            name: "Controlled consolidated first draft",
            versions: [{ id: "template-version-1", versionNumber: 1 }],
          },
        ]);
      if (path.endsWith("draft-generation-runs/failed-run/retry"))
        return Promise.reject(new PublicApiError("Conflict", 409, "CONFLICT"));
      if (path.endsWith("draft-generation-runs") && init?.method === "POST")
        return Promise.resolve({
          id: "fresh-run",
          safeFailureCode: null,
          sourceMode: "TENDER_ONLY",
          status: "QUEUED",
          title: "Proposal draft",
        });
      if (path.endsWith("draft-generation-runs"))
        return Promise.resolve([
          {
            id: "failed-run",
            safeFailureCode: "DRAFT_INPUTS_NOT_CURRENT",
            sourceMode: "TENDER_ONLY",
            status: "FAILED",
            title: "Proposal draft",
          },
        ]);
      if (path.endsWith("/drafts")) return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
    const user = userEvent.setup();
    render(<DraftWorkspace organisationId="org-1" tenderId="tender-1" />);

    await user.click(await screen.findByRole("button", { name: "Retry" }));

    const calls = apiRequest.mock.calls as unknown as readonly (readonly [
      string,
      RequestInit?,
    ])[];
    const freshStart = calls.find(
      ([path, init]) =>
        path.endsWith("draft-generation-runs") && init?.method === "POST",
    );
    expect(freshStart?.[1]?.method).toBe("POST");
    const body = freshStart?.[1]?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string") throw new Error("Expected JSON body");
    expect(body).toContain('"title":"Proposal draft"');
  });
});
