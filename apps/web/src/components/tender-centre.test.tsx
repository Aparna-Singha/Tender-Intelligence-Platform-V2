import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenderCentre } from "./tender-centre";

const { apiRequest, router } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  router: { push: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

describe("TenderCentre row presentation", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    router.push.mockReset();
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

  it("uses client-side navigation after creating a tender", async () => {
    apiRequest.mockImplementation((_path: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? { tender_id: "tender-2" } : []),
    );
    const user = userEvent.setup();
    render(<TenderCentre organisationId="org-1" />);
    await user.click(
      screen.getByRole("button", { name: /Analyse new tender/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Tender title" }),
      "Demo tender",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Buyer" }),
      "Demo buyer",
    );
    const deadline = screen.getByLabelText(/Submission deadline/);
    fireEvent.change(deadline, { target: { value: "2026-12-09T12:00" } });
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Create tender workspace" }),
      ).getByRole("button", { name: "Create and upload files" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        "/tenders/org-1/tender-2?stage=files",
      ),
    );
  });
});
