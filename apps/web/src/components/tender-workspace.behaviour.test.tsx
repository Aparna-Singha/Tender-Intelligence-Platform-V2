import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TenderWorkspace } from "./tender-workspace";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/tenders/org-1/tender-1",
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../lib/api", () => ({
  apiRequest: vi.fn().mockResolvedValue({
    buyer: "Buyer department",
    corrigenda: [],
    id: "tender-1",
    lifecycleStatus: "DRAFT",
    processingJobs: [],
    sources: [],
    title: "Office equipment tender",
    versions: [
      {
        documents: [],
        id: "version-1",
        reason: "Original tender source",
        versionNumber: 1,
      },
    ],
    workspace: { processingProgress: 0, sourceSectionStatus: "NOT_STARTED" },
  }),
}));
vi.mock("./extraction-workspace", () => ({
  ExtractionWorkspace: () => <div>Extraction module mounted</div>,
}));
vi.mock("./risk-workspace", () => ({
  RiskWorkspace: () => <div>Risk module mounted</div>,
}));
vi.mock("./evidence-matrix", () => ({
  EvidenceMatrix: () => <div>Evidence module mounted</div>,
}));
vi.mock("./action-checklist", () => ({
  ActionChecklist: () => <div>Checklist module mounted</div>,
}));
vi.mock("./rag-chatbot", () => ({
  RagChatbot: () => <div>Ask module mounted</div>,
}));
vi.mock("./draft-workspace", () => ({
  DraftWorkspace: () => <div>Draft module mounted</div>,
}));

describe("tender workspace stages", () => {
  it("starts at overview, exposes only supported stages, and updates the URL", async () => {
    const user = userEvent.setup();
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    await screen.findByText("Office equipment tender");
    expect(screen.getByText("Workspace overview")).toBeInTheDocument();
    expect(screen.queryByText("Risk module mounted")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Risks" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/tenders/org-1/tender-1?stage=risks"),
    );
  });
});
