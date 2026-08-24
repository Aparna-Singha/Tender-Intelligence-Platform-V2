import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionChecklist } from "./action-checklist";

const { PublicApiErrorMock, apiRequest } = vi.hoisted(() => {
  class PublicApiErrorMock extends Error {
    public constructor(
      message: string,
      public readonly status: number,
      public readonly code: string,
    ) {
      super(message);
    }
  }

  return { PublicApiErrorMock, apiRequest: vi.fn() };
});

vi.mock("../lib/api", () => ({
  PublicApiError: PublicApiErrorMock,
  apiRequest,
  formatApiError: (error: unknown, fallback: string) =>
    error instanceof Error && error.message !== "" ? error.message : fallback,
}));

const source = readFileSync(
  resolve(process.cwd(), "src/components/action-checklist.tsx"),
  "utf8",
);
const normalizedSource = source.replace(/\s+/g, " ");

const run: {
  assessmentRunId: string;
  checklistPolicyVersion: string;
  completedAt: string;
  evidenceSnapshotId: string;
  id: string;
  invalidatedAt: string | null;
  progressPercentage: number;
  publicMessage: string;
  status: string;
} = {
  assessmentRunId: "assessment-1",
  checklistPolicyVersion: "phase-7-deterministic-policy",
  completedAt: "2026-08-24T09:00:00.000Z",
  evidenceSnapshotId: "snapshot-1",
  id: "run-1",
  invalidatedAt: null,
  progressPercentage: 25,
  publicMessage:
    "Phase 7 currentness trace remains available in advanced history.",
  status: "IN_PROGRESS",
};

const result = {
  items: [
    {
      completionCriteria:
        "An authorised reviewer records a cited interpretation in Phase 7.",
      currentDueDate: null,
      currentPriority: "HIGH",
      currentTitle: "Review ambiguous requirement",
      dateIsOfficial: false,
      evidenceNeedCategory: "LEGAL_INTERPRETATION",
      id: "item-1",
      itemType: "REVIEW_ACTION",
      proposedExplanation:
        "This action is derived from the current controlled Phase 7 assessment.",
      status: "READY_FOR_REASSESSMENT",
    },
  ],
  priority_counts: [{ _count: 1, currentPriority: "HIGH" }],
  status_counts: [{ _count: 1, status: "READY_FOR_REASSESSMENT" }],
  total: 1,
};

function installApi(options?: {
  readonly patchError?: Error;
  readonly resultValue?: typeof result;
  readonly runsValue?: readonly (typeof run)[];
}): void {
  apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (
      path ===
      "/organisations/org-1/tenders/tender-1/versions/version-1/checklists"
    )
      return Promise.resolve(options?.runsValue ?? [run]);
    if (path === "/organisations/org-1/tenders/tender-1/checklists/run-1/items")
      return Promise.resolve(options?.resultValue ?? result);
    if (
      path ===
        "/organisations/org-1/tenders/tender-1/checklists/run-1/items/item-1" &&
      init?.method === "PATCH"
    ) {
      if (options?.patchError !== undefined) {
        return Promise.reject(options.patchError);
      }
      return Promise.resolve({});
    }
    return Promise.reject(new Error(`Unexpected API call: ${path}`));
  });
}

function renderChecklist(
  currentAssessmentRunId: string | null = "assessment-1",
  presentation: "full" | "history" = "full",
): void {
  render(
    <ActionChecklist
      currentAssessmentRunId={currentAssessmentRunId}
      organisationId="org-1"
      presentation={presentation}
      tenderId="tender-1"
      versionId="version-1"
    />,
  );
}

function patchBody(): Record<string, unknown> {
  const call = (
    apiRequest.mock.calls as unknown as readonly [
      string,
      RequestInit | undefined,
    ][]
  ).find(
    ([path, init]) =>
      path.endsWith("/checklists/run-1/items/item-1") &&
      init?.method === "PATCH",
  );
  const body = call?.[1]?.body;
  return JSON.parse(typeof body === "string" ? body : "{}") as Record<
    string,
    unknown
  >;
}

describe("Phase 8 checklist workspace", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("uses required human-control and no-score language", () => {
    expect(normalizedSource).toContain(
      "Completing an action does not automatically determine overall eligibility",
    );
    expect(source).toContain("No current action list yet");
    expect(source).toContain("Missing-item progress");
    expect(source).toContain("More actions");
    expect(normalizedSource).toContain("Audit &amp; evidence");
    expect(source).not.toContain("Advanced checklist history");
    expect(source).not.toContain("bid readiness score");
    expect(source).not.toContain("probability of success");
  });

  it("renders plain-language default cards while preserving advanced technical history", async () => {
    installApi();
    renderChecklist();

    const card = (
      await screen.findByText("Review ambiguous requirement")
    ).closest("article");
    expect(card).not.toBeNull();
    expect(
      screen.getByText(
        /An authorised reviewer needs to record a cited interpretation\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This action is derived from the latest eligibility review.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(card!).getByRole("button", {
        name: "Resolve using latest review",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No authoritative due date is available/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/current controlled Phase 7 assessment/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/cited interpretation in Phase 7/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Phase 7 currentness trace remains available/i),
    ).not.toBeInTheDocument();
  });

  it("separates historical action lists from the current eligibility state", async () => {
    installApi({
      runsValue: [
        {
          ...run,
          assessmentRunId: "assessment-old",
          invalidatedAt: "2026-08-24T10:00:00.000Z" as string | null,
        },
      ],
    });
    renderChecklist(null);

    expect(
      await screen.findByText("No current action list yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Previous action lists remain available in Audit & evidence\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Review ambiguous requirement"),
    ).not.toBeInTheDocument();
  });

  it("can render checklist history without a primary empty current-work state", async () => {
    installApi({
      runsValue: [
        {
          ...run,
          assessmentRunId: "assessment-old",
          invalidatedAt: "2026-08-24T10:00:00.000Z" as string | null,
        },
      ],
    });
    renderChecklist(null, "history");

    expect(await screen.findByText("Action-list history")).toBeInTheDocument();
    expect(
      screen.queryByText("No current action list yet"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh action list")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Current and previous action-list runs/i),
    ).toBeInTheDocument();
  });

  it("uses an in-app rationale dialog with validation before resolving", async () => {
    installApi();
    renderChecklist();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Resolve using latest review",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Resolve item" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Resolve item" }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Enter at least 10 characters.",
    );

    fireEvent.change(within(dialog).getByLabelText("Rationale"), {
      target: {
        value: "Cited interpretation was reviewed against the latest evidence.",
      },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Resolve item" }),
    );

    await waitFor(() =>
      expect(patchBody()).toMatchObject({
        rationale:
          "Cited interpretation was reviewed against the latest evidence.",
        resolution_note:
          "Cited interpretation was reviewed against the latest evidence.",
        status: "RESOLVED",
      }),
    );
  });

  it("reloads the latest data after a stale-write rejection without replaying the mutation", async () => {
    installApi({
      patchError: new PublicApiErrorMock("stale", 409, "STALE_WRITE"),
    });
    renderChecklist();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Resolve using latest review",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Resolve item" });
    fireEvent.change(within(dialog).getByLabelText("Rationale"), {
      target: {
        value: "Cited interpretation was reviewed against the latest evidence.",
      },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Resolve item" }),
    );

    expect(
      await screen.findByText(
        /This item changed while you were reviewing it\. We loaded the latest version\. Please review it again\./,
      ),
    ).toBeInTheDocument();

    const itemLoads = (
      apiRequest.mock.calls as unknown as readonly [
        string,
        RequestInit | undefined,
      ][]
    ).filter(
      ([path, init]) =>
        path.endsWith("/checklists/run-1/items") && init === undefined,
    );
    const patches = (
      apiRequest.mock.calls as unknown as readonly [
        string,
        RequestInit | undefined,
      ][]
    ).filter(
      ([path, init]) =>
        path.endsWith("/checklists/run-1/items/item-1") &&
        init?.method === "PATCH",
    );

    expect(itemLoads.length).toBeGreaterThanOrEqual(2);
    expect(patches).toHaveLength(1);
  });

  it("keeps rationale typing stable while checklist history refreshes", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    try {
      const user = userEvent.setup();
      installApi();
      renderChecklist();

      await user.click(
        await screen.findByRole("button", {
          name: "Resolve using latest review",
        }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Resolve item",
      });
      const rationale = within(dialog).getByLabelText("Rationale");
      const intervalCallback = intervalSpy.mock.calls[0]?.[0];
      const checklistLoadsBefore = (
        apiRequest.mock.calls as unknown as readonly [
          string,
          RequestInit | undefined,
        ][]
      ).filter(
        ([path, init]) =>
          path.endsWith("/versions/version-1/checklists") && init === undefined,
      ).length;

      expect(typeof intervalCallback).toBe("function");

      fireEvent.change(rationale, { target: { value: "A" } });
      act(() => {
        (intervalCallback as () => void)();
      });
      await waitFor(() =>
        expect(
          (
            apiRequest.mock.calls as unknown as readonly [
              string,
              RequestInit | undefined,
            ][]
          ).filter(
            ([path, init]) =>
              path.endsWith("/versions/version-1/checklists") &&
              init === undefined,
          ).length,
        ).toBeGreaterThan(checklistLoadsBefore),
      );
      fireEvent.change(rationale, {
        target: { value: "A longer rationale" },
      });

      expect(rationale).toHaveValue("A longer rationale");
      expect(
        (
          apiRequest.mock.calls as unknown as readonly [
            string,
            RequestInit | undefined,
          ][]
        ).filter(
          ([path, init]) =>
            path.endsWith("/checklists/run-1/items/item-1") &&
            init?.method === "PATCH",
        ),
      ).toHaveLength(0);
    } finally {
      intervalSpy.mockRestore();
    }
  });
});
