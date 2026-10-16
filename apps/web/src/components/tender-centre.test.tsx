import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenderCentre } from "./tender-centre";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

describe("TenderCentre row presentation", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue([
      {
        buyer: "Uranium Corporation of India Ltd",
        id: "tender-1",
        isDemonstration: false,
        lifecycleStatus: "SOURCE_READY",
        sourceTenderNumber: "T-001",
        submissionDeadline: "2026-10-30T12:00:00.000Z",
        title: "Overload relay and its accessories",
        workflowState: {
          actionLabel: "Review draft",
          code: "DRAFTING",
          detail:
            "A current draft is ready for human review and controlled export steps.",
          isCompleted: false,
          isDraft: true,
          isInProgress: false,
          needsAttention: true,
          onHold: false,
          statusLabel: "Draft ready",
          tone: "accent",
        },
        workspace: { processingProgress: 100, status: "READY" },
      },
    ]);
  });

  it("keeps each tender and next action to one concise line", async () => {
    render(<TenderCentre organisationId="org-1" />);

    expect(
      await screen.findByText("Overload relay and its accessories"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Uranium Corporation of India Ltd"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "A current draft is ready for human review and controlled export steps.",
      ),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText("Review draft")).toHaveLength(2),
    );
  });
});
