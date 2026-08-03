import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FinalReadinessWorkspace } from "./final-readiness-workspace";
import { PublicApiError } from "../lib/api";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../lib/api", () => ({
  PublicApiError: class PublicApiError extends Error {
    public constructor(
      message: string,
      public readonly status: number,
      public readonly code: string,
      public readonly requestId?: string,
    ) {
      super(message);
    }
  },
  apiRequest,
}));

const token =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const run = {
  completed_at: "2026-08-04T10:04:00.000Z",
  created_at: "2026-08-04T10:00:00.000Z",
  current_disposition: null,
  disposition_concurrency_token: token,
  failure_code: null,
  final_risk_run_id: "risk-run-1",
  final_risk_status: "COMPLETED",
  finding_counts: {
    blockers: 1,
    human_disposition_required: 1,
    informational: 1,
    warnings: 1,
  },
  id: "run-1",
  invalidated: false,
  is_current: true,
  policy_version: "final-readiness-deterministic-v1",
  stale: false,
  started_at: "2026-08-04T10:01:00.000Z",
  status: "COMPLETED",
  tender_version_id: "version-1",
  updated_at: "2026-08-04T10:04:00.000Z",
};
const finding = {
  created_at: "2026-08-04T10:03:00.000Z",
  current_review_version: 2,
  explanation: "A material ambiguity requires an explicit human disposition.",
  id: "finding-1",
  lifecycle_state: "OPEN",
  materiality: "MATERIAL",
  provenance: [{ id: "citation-1", source_class: "EXTRACTION_CITATION" }],
  provenance_valid: true,
  review_state: "HUMAN_REVIEW_REQUIRED",
  review_summary: {
    acknowledgement_recorded: false,
    latest_action: null,
    reviewed_at: null,
    reviewer: null,
  },
  rule_code: "MATERIAL_EXTRACTION_AMBIGUITY",
  title: "Material extraction ambiguity",
  treatment: "HUMAN_DISPOSITION_REQUIRED",
};
const blocker = {
  ...finding,
  id: "finding-2",
  rule_code: "INVALID_MATERIAL_CITATION",
  title: "Invalid material citation",
  treatment: "BLOCKER",
};
const preflight = {
  eligible_independent_decision_actor_exists: true,
  evaluated_at: "2026-08-04T09:59:00.000Z",
  hard_prerequisites_pass: true,
  informational_only: true,
  policy_version: "final-readiness-deterministic-v1",
  prerequisite_denials: [],
  qualifying_consolidated_draft_version_id: "draft-version-1",
  tender_version_id: "version-1",
  transactional_revalidation_required: true,
};
type TestRun = Omit<
  typeof run,
  | "completed_at"
  | "failure_code"
  | "invalidated"
  | "is_current"
  | "stale"
  | "status"
> & {
  completed_at: string | null;
  failure_code: string | null;
  invalidated: boolean;
  is_current: boolean;
  stale: boolean;
  status: string;
};

function installApi(
  role = "REVIEWER",
  runValue: TestRun = run,
  preflightValue: Omit<
    typeof preflight,
    "prerequisite_denials" | "qualifying_consolidated_draft_version_id"
  > & {
    prerequisite_denials: readonly {
      code: string;
      prerequisite: string;
    }[];
    qualifying_consolidated_draft_version_id: string | null;
  } = preflight,
): void {
  apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/organisations")
      return Promise.resolve([{ organisation: { id: "org-1" }, role }]);
    if (path.endsWith("/final-readiness/preflight"))
      return Promise.resolve(preflightValue);
    if (path.includes("/versions/version-1/final-readiness/current"))
      return Promise.resolve({ run: runValue });
    if (path.includes("/versions/version-1/final-readiness?"))
      return Promise.resolve({ items: [runValue], next_cursor: null });
    if (path.endsWith("/final-readiness/run-1/events"))
      return Promise.resolve(runValue);
    if (path.endsWith("/final-readiness/run-1/findings?limit=100"))
      return Promise.resolve({ items: [finding, blocker], next_cursor: null });
    if (path.endsWith("/final-readiness/run-1"))
      if (init?.method === "DELETE")
        return Promise.resolve({ cancellation_requested: true });
      else
        return Promise.resolve({
          occurred_at: runValue.updated_at,
          progress_percent: runValue.status === "PROCESSING" ? 40 : 100,
          stage:
            runValue.status === "PROCESSING"
              ? "EVALUATING_FINAL_RISK"
              : "COMPLETE",
          status: runValue.status,
        });
    if (path.endsWith("/risk-analyses/risk-run-1/findings"))
      return Promise.resolve([
        {
          confidence: "HIGH",
          explanation: "A cited final-risk finding remains auditable.",
          findingStatus: "OPEN",
          id: "risk-finding-1",
          materiality: "MATERIAL",
          reviewState: "HUMAN_REVIEW_REQUIRED",
          severity: "HIGH",
          title: "Final cited risk",
        },
      ]);
    if (
      path.endsWith("/findings/finding-1/reviews") &&
      init?.method === undefined
    )
      return Promise.resolve({
        items: [
          {
            acknowledgement_recorded: true,
            action: "ACKNOWLEDGE",
            actor: { display_name: "Independent Reviewer" },
            created_at: "2026-08-04T10:02:00.000Z",
            id: "review-1",
            rationale: "The cited ambiguity was independently acknowledged.",
            review_version: 1,
          },
        ],
      });
    if (path.endsWith("/findings/finding-1/reviews") && init?.method === "POST")
      return Promise.resolve({});
    if (path.endsWith("/findings/finding-1"))
      return Promise.resolve({ ...finding, current_review_version: 3 });
    if (path.endsWith("/decisions") && init?.method === "POST")
      return Promise.resolve({});
    if (path.endsWith("/final-readiness") && init?.method === "POST")
      return Promise.resolve({ run_id: "run-1" });
    if (
      path.endsWith("/final-readiness/run-1/retry") &&
      init?.method === "POST"
    )
      return Promise.resolve({ run_id: "run-1" });
    return Promise.reject(new Error(`Unexpected API call: ${path}`));
  });
}

function renderWorkspace(onNavigateStage = vi.fn()): void {
  render(
    <FinalReadinessWorkspace
      onNavigateStage={onNavigateStage}
      organisationId="org-1"
      tenderId="tender-1"
      versionId="version-1"
    />,
  );
}

function calls(): readonly [string, RequestInit | undefined][] {
  return apiRequest.mock.calls as unknown as readonly [
    string,
    RequestInit | undefined,
  ][];
}

function mutationBody(pathSuffix: string): Record<string, unknown> {
  const body = calls().find(
    ([path, init]) => path.endsWith(pathSuffix) && init?.method === "POST",
  )?.[1]?.body;
  return JSON.parse(typeof body === "string" ? body : "{}") as Record<
    string,
    unknown
  >;
}

describe("final readiness workspace", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    vi.stubGlobal("crypto", { randomUUID: () => "idempotency-key-123" });
  });

  it("shows preflight, lifecycle timestamps, treatments, provenance and separate final risk", async () => {
    installApi();
    const navigate = vi.fn();
    renderWorkspace(navigate);
    expect(
      await screen.findByText("Hard prerequisites currently pass"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Linked FINAL_READINESS risk analysis"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Material extraction ambiguity"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Treatment: Human disposition required/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Extraction citation")).toHaveLength(2);
    expect(screen.getAllByText(/4\/8\/2026/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/readiness score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/approved to submit/i)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Open extraction" })[0]!,
    );
    expect(navigate).toHaveBeenCalledWith("extraction");
  });

  it("starts through the transactional API with only an idempotency key", async () => {
    installApi("OWNER");
    renderWorkspace();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Start final-readiness audit",
      }),
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/tenders/tender-1/final-readiness",
        {
          body: JSON.stringify({ idempotency_key: "idempotency-key-123" }),
          method: "POST",
        },
      ),
    );
    const mutation = JSON.stringify(
      calls().find(([, init]) => init?.method === "POST")?.[1],
    );
    expect(mutation).not.toMatch(
      /actor|role|snapshot|final_risk|fingerprint|queue/i,
    );
  });

  it("shows failed prerequisite and independent-actor states without a final conclusion", async () => {
    installApi("OWNER", run, {
      ...preflight,
      eligible_independent_decision_actor_exists: false,
      hard_prerequisites_pass: false,
      prerequisite_denials: [
        { code: "PREREQUISITE_INVALIDATED", prerequisite: "EXTRACTION" },
      ],
      qualifying_consolidated_draft_version_id: null,
    });
    renderWorkspace();
    expect(
      await screen.findByText("Hard prerequisites need attention"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/invite or assign an eligible reviewer/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Prerequisite invalidated/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start final-readiness audit" }),
    ).toBeDisabled();
    expect(screen.queryByText(/final conclusion/i)).not.toBeInTheDocument();
  });

  it("uses server lifecycle state for cancellation, retry, stale and invalidated visibility", async () => {
    const prompt = vi
      .spyOn(window, "prompt")
      .mockReturnValue("Cancel because the authoritative inputs are changing.");
    installApi("OWNER", { ...run, completed_at: null, status: "PROCESSING" });
    const view = render(
      <FinalReadinessWorkspace
        onNavigateStage={vi.fn()}
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel run" }),
    );
    expect(
      calls().some(
        ([path, init]) =>
          path.endsWith("/final-readiness/run-1") && init?.method === "DELETE",
      ),
    ).toBe(true);

    view.unmount();
    apiRequest.mockReset();
    installApi("OWNER", {
      ...run,
      failure_code: "SOURCE_SET_CHANGED",
      invalidated: true,
      is_current: false,
      stale: true,
      status: "FAILED",
    });
    renderWorkspace();
    expect(await screen.findByText("Invalidated")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry as a new run" }),
    );
    expect(
      calls().some(
        ([path, init]) => path.endsWith("/retry") && init?.method === "POST",
      ),
    ).toBe(true);
    prompt.mockRestore();
  });

  it("loads append-only history and submits the authoritative current review version", async () => {
    installApi();
    renderWorkspace();
    const trigger = (
      await screen.findAllByRole("button", {
        name: "Review history and action",
      })
    )[0]!;
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "Finding review",
    });
    expect(within(dialog).getByText(/Version 1/)).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText("Rationale"),
      "A sufficiently detailed independent review rationale.",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Append review" }),
    );
    await waitFor(() => {
      expect(mutationBody("/findings/finding-1/reviews")).toMatchObject({
        expected_current_review_version: 2,
      });
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Close" }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps disposition unselected, blocks Proceed, and submits the token unchanged for Hold", async () => {
    installApi();
    renderWorkspace();
    const proceed = await screen.findByRole("button", {
      name: "Proceed to controlled export review",
    });
    expect(proceed).toBeDisabled();
    const hold = screen.getByRole("button", { name: "Hold for remediation" });
    await userEvent.click(hold);
    const dialog = screen.getByRole("dialog", {
      name: "Confirm final disposition",
    });
    await userEvent.type(
      within(dialog).getByLabelText("Mandatory rationale"),
      "Remediation remains necessary before any controlled review.",
    );
    await userEvent.click(within(dialog).getByLabelText(/Acknowledge:/));
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Confirm Hold for remediation",
      }),
    );
    await waitFor(() => {
      expect(mutationBody("/decisions")).toEqual({
        acknowledgement_ids: ["finding-1"],
        disposition: "HOLD_FOR_REMEDIATION",
        expected_fingerprint: token,
        rationale:
          "Remediation remains necessary before any controlled review.",
        run_id: "run-1",
      });
    });
  });

  it("renders history without mutation controls for a read-only role", async () => {
    installApi("CONSULTANT");
    renderWorkspace();
    const trigger = (
      await screen.findAllByRole("button", {
        name: "Review history",
      })
    )[0]!;
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Finding review" });
    expect(within(dialog).getByText(/Version 1/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Append review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Final human disposition"),
    ).not.toBeInTheDocument();
  });

  it("maps stable errors without exposing internal exception text", async () => {
    installApi("OWNER");
    apiRequest.mockImplementationOnce(() =>
      Promise.reject(
        new PublicApiError(
          "Prisma unique constraint and private/object-key",
          409,
          "FINAL_READINESS_PREREQUISITES_NOT_CURRENT",
          "request-safe",
        ),
      ),
    );
    renderWorkspace();
    expect(
      await screen.findByText(/Current authoritative prerequisites/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Request ID: request-safe/)).toBeInTheDocument();
    expect(screen.queryByText(/Prisma|object-key/)).not.toBeInTheDocument();
  });
});

describe("final readiness responsive and content safety", () => {
  it("uses bounded responsive layout and contains no export or sensitive-body behavior", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/final-readiness-workspace.tsx"),
      "utf8",
    );
    expect(source).toContain(
      'style={{ minWidth: 0, overflowWrap: "anywhere" }}',
    );
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-modal="true"');
    expect(source).not.toMatch(
      /sourceBody|evidenceValue|draftText|objectKey|credential/i,
    );
    expect(source).not.toContain("Export package");
    expect(source).not.toContain("Submit bid");
  });
});
