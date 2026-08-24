import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlledReviewPackageWorkspace } from "./controlled-review-package-workspace";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

const source = readFileSync(
  "src/components/controlled-review-package-workspace.tsx",
  "utf8",
);

interface TestIssue {
  readonly code: string;
  readonly treatment:
    | "DOWNLOAD_BLOCKER"
    | "HARD_GENERATION_BLOCKER"
    | "PACKAGE_WARNING"
    | "REVIEW_BLOCKER";
}

interface TestPreflight {
  readonly active_run: { readonly id: string } | null;
  readonly eligible_independent_approver_exists: boolean;
  readonly hard_prerequisites_pass: boolean;
  readonly issues: readonly TestIssue[];
  readonly qualifying_export_template_version_id: string | null;
  readonly transactional_revalidation_required: true;
}

const preflight: TestPreflight = {
  active_run: null,
  eligible_independent_approver_exists: true,
  hard_prerequisites_pass: false,
  issues: [
    {
      code: "READINESS_RUN_NOT_CURRENT",
      treatment: "HARD_GENERATION_BLOCKER",
    },
    {
      code: "READINESS_RUN_INVALIDATED",
      treatment: "HARD_GENERATION_BLOCKER",
    },
    {
      code: "FINAL_RISK_RUN_NOT_COMPLETE",
      treatment: "REVIEW_BLOCKER",
    },
    {
      code: "APPROVED_DRAFT_NOT_PINNED",
      treatment: "HARD_GENERATION_BLOCKER",
    },
    {
      code: "SOURCE_HASH_UNAVAILABLE",
      treatment: "DOWNLOAD_BLOCKER",
    },
  ],
  qualifying_export_template_version_id: null,
  transactional_revalidation_required: true,
};

const readyPreflight: TestPreflight = {
  ...preflight,
  hard_prerequisites_pass: true,
  issues: [],
};

function installApi(options?: {
  readonly history?: readonly unknown[];
  readonly preflightValue?: TestPreflight;
}): void {
  apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (
      path ===
      "/organisations/org-1/tenders/tender-1/controlled-review-packages/preflight"
    )
      return Promise.resolve(options?.preflightValue ?? preflight);
    if (
      path ===
      "/organisations/org-1/tenders/tender-1/versions/version-1/controlled-review-packages"
    )
      return Promise.resolve({
        items: options?.history ?? [],
        next_cursor: null,
      });
    if (
      path ===
        "/organisations/org-1/tenders/tender-1/controlled-review-packages" &&
      init?.method === "POST"
    )
      return Promise.resolve({ package_id: "package-1" });
    if (
      path ===
      "/organisations/org-1/tenders/tender-1/controlled-review-packages/package-1"
    )
      return Promise.resolve({
        artifact_id: null,
        created_at: "2026-08-24T10:00:00.000Z",
        failure_code: null,
        freshness: "CURRENT",
        generation_status: "GENERATED",
        id: "package-1",
        input_fingerprint: "abcdef0123456789",
        is_current: true,
        requested_by: { display_name: "Owner", role_at_action: "OWNER" },
        review_status: "IN_REVIEW",
        review_version: 1,
      });
    if (
      path ===
      "/organisations/org-1/tenders/tender-1/controlled-review-packages/package-1/reviews"
    )
      return Promise.resolve({ items: [] });
    if (
      path ===
      "/organisations/org-1/tenders/tender-1/controlled-review-packages/package-1/decisions"
    )
      return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`Unexpected API call: ${path}`));
  });
}

function renderWorkspace(onNavigateStage = vi.fn()): void {
  render(
    <ControlledReviewPackageWorkspace
      onNavigateStage={onNavigateStage}
      organisationId="org-1"
      tenderId="tender-1"
      versionId="version-1"
    />,
  );
}

describe("controlled review package workspace", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    vi.stubGlobal("crypto", { randomUUID: () => "package-key-1" });
  });

  it("keeps generation, review, controlled approval, and download distinct", () => {
    expect(source).toContain("Create review package");
    expect(source).toContain("Record review complete");
    expect(source).toContain("Approve for controlled download");
    expect(source).toContain("Revoke controlled download");
    expect(source).toContain("Authorise one-minute download");
    expect(source).not.toContain("Approved for submission");
  });

  it("uses opaque server authority and never displays storage keys", () => {
    expect(source).toContain("crypto.randomUUID()");
    expect(source).not.toMatch(
      /object[_ ]key|signed[_ ]url|localStorage|sessionStorage/i,
    );
    expect(source).toContain("transaction always revalidates authority");
  });

  it("renders blockers, warnings, immutable history, and accessibility labels", () => {
    for (const value of [
      "HARD_GENERATION_BLOCKER",
      "PACKAGE_WARNING",
      "REVIEW_BLOCKER",
      "DOWNLOAD_BLOCKER",
      "Controlled download",
      "Package history",
      "Current package",
      "Append-only review comment",
      "Approval history",
      "aria-live",
    ])
      expect(source).toContain(value);
    expect(source).not.toMatch(/window\.prompt|window\.confirm/);
  });

  it("deduplicates internal blockers into clear user-facing actions", async () => {
    installApi();
    const navigate = vi.fn();
    renderWorkspace(navigate);

    expect(
      await screen.findByText("Before you can create the review package"),
    ).toBeInTheDocument();
    const summaryCard = screen
      .getByText("Before you can create the review package")
      .closest("section");
    expect(summaryCard).not.toBeNull();
    expect(
      within(summaryCard!).getByText("Current blockers"),
    ).toBeInTheDocument();
    expect(
      within(summaryCard!).getByText("Final review needs attention"),
    ).toBeInTheDocument();
    expect(
      within(summaryCard!).getByText("Risk review needs attention"),
    ).toBeInTheDocument();
    expect(
      within(summaryCard!).getByText("Proposal draft needs approval"),
    ).toBeInTheDocument();
    expect(within(summaryCard!).getByText("Next stage")).toBeInTheDocument();
    expect(
      within(summaryCard!).getByText("Source verification is incomplete"),
    ).toBeInTheDocument();
    expect(
      within(summaryCard!).queryByText("Readiness run not current"),
    ).not.toBeInTheDocument();

    const advancedDetails = screen
      .getByText(/Advanced readiness and audit details/i)
      .closest("details");
    expect(advancedDetails).not.toBeNull();
    await userEvent.click(
      within(advancedDetails!).getByText(
        /Advanced readiness and audit details/i,
      ),
    );
    expect(screen.getByText("Readiness run not current")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open draft" }));
    expect(navigate).toHaveBeenCalledWith("draft");
  });

  it("uses an in-app confirmation dialog before package creation", async () => {
    installApi({ preflightValue: readyPreflight });
    renderWorkspace();

    await userEvent.click(
      await screen.findByRole("button", { name: "Create review package" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Create review package",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create review package" }),
    );

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/tenders/tender-1/controlled-review-packages",
        {
          body: JSON.stringify({ idempotency_key: "package-key-1" }),
          method: "POST",
        },
      ),
    );
  });
});
