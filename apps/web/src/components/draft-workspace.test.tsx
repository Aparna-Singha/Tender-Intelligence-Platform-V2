import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DraftWorkspace } from "./draft-workspace";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
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
  beforeEach(() => {
    apiRequest.mockReset();
    installApi();
  });

  it("shows human-control and source limitations", () => {
    expect(source).toContain("AI-assisted first draft");
    expect(source).toContain("Human review is mandatory");
    expect(source).toContain("does not determine legal compliance");
  });

  it("shows citations, placeholders, history, and review controls", () => {
    expect(source).toContain("Version history");
    expect(source).toContain("Draft history");
    expect(source).toContain("Placeholders");
    expect(source).toContain("Request review");
    expect(source).toContain("Request changes");
    expect(source).toContain("Approve for final readiness review");
    expect(source).toContain("Open review package");
    expect(source).toContain("Source scope");
    expect(source).toContain("citation");
  });

  it("does not expose readiness, export, scraping, or submission actions", () => {
    expect(source).not.toContain("Run final readiness");
    expect(source).not.toContain("Export package");
    expect(source).not.toContain("Open Review & Export");
    expect(source).not.toContain("Scrape");
    expect(source).not.toContain("Submit bid");
  });

  it("keeps empty-state ownership on Draft instead of review controls", () => {
    expect(source).toContain("No proposal draft yet");
    expect(source).toContain("Set up draft");
  });

  it("opens draft setup before focusing the title input and does not fire a mutation", async () => {
    render(<DraftWorkspace organisationId="org-1" tenderId="tender-1" />);

    const setupButton = await screen.findByRole("button", {
      name: "Set up draft",
    });
    await userEvent.click(setupButton);

    const titleInput = screen.getByLabelText("Draft title");
    await waitFor(() => expect(titleInput).toHaveFocus());
    expect(screen.getByText("Start a new proposal draft")).toBeInTheDocument();
    expect(
      screen.getByText(/Draft setup is open in the main workspace/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Draft setup and history").closest("details"),
    ).toHaveAttribute("open");
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });
});
