import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TenderWorkspace } from "./tender-workspace";

const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/tenders/org-1/tender-1",
  useRouter: () => ({ push }),
  useSearchParams: () => search,
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
  formatApiError: (_error: unknown, fallback: string) => fallback,
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
vi.mock("./final-readiness-workspace", () => ({
  FinalReadinessWorkspace: () => <div>Readiness module mounted</div>,
}));
vi.mock("./controlled-review-package-workspace", () => ({
  ControlledReviewPackageWorkspace: () => <div>Export module mounted</div>,
}));

describe("tender workspace stages", () => {
  it("starts at overview, exposes only supported stages, and updates the URL", async () => {
    search = new URLSearchParams();
    const user = userEvent.setup();
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    await screen.findByText("Office equipment tender");
    expect(screen.getByText("Workspace overview")).toBeInTheDocument();
    expect(screen.queryByText("Risk module mounted")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Risks" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/tenders/org-1/tender-1?stage=risks"),
    );
  });

  it("mounts only readiness from a direct URL and places it after Draft", async () => {
    search = new URLSearchParams("stage=readiness");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    await screen.findByText("Readiness module mounted");
    expect(screen.queryByText("Workspace overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft module mounted")).not.toBeInTheDocument();
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels.indexOf("Readiness")).toBe(labels.indexOf("Draft") + 1);
    expect(labels.indexOf("Export")).toBe(labels.indexOf("Readiness") + 1);
  });

  it("retains the safe overview fallback for an unsupported stage", async () => {
    search = new URLSearchParams("stage=submission");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    expect(await screen.findByText("Workspace overview")).toBeInTheDocument();
    expect(
      screen.queryByText("Readiness module mounted"),
    ).not.toBeInTheDocument();
  });

  it("mounts controlled review export after readiness", async () => {
    search = new URLSearchParams("stage=export");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    expect(
      await screen.findByText("Export module mounted"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Readiness module mounted"),
    ).not.toBeInTheDocument();
  });

  it("follows stage changes supplied by browser back and forward navigation", async () => {
    search = new URLSearchParams("stage=readiness");
    const view = render(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    await screen.findByText("Readiness module mounted");
    search = new URLSearchParams("stage=draft");
    view.rerender(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    expect(await screen.findByText("Draft module mounted")).toBeInTheDocument();
    expect(
      screen.queryByText("Readiness module mounted"),
    ).not.toBeInTheDocument();
    search = new URLSearchParams("stage=readiness");
    view.rerender(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    expect(
      await screen.findByText("Readiness module mounted"),
    ).toBeInTheDocument();
  });
});
