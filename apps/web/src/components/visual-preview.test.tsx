import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, push, uploadFileToSignedStorageUrl } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  push: vi.fn(),
  uploadFileToSignedStorageUrl: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../lib/api", () => ({ apiRequest }));
vi.mock("../lib/direct-upload", () => ({ uploadFileToSignedStorageUrl }));

import { VisualPreview } from "./visual-preview";

describe("synthetic visual preview", () => {
  beforeEach(() => vi.clearAllMocks());
  it("separates documents from review and never requests the backend", async () => {
    render(<VisualPreview view="evidence" />);
    expect(screen.getAllByText(/BidVeda/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "Evidence workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Document context" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Evidence review" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not independently verified/)).toBeInTheDocument();
    expect(screen.getByText(/Recorded: Verified/)).toBeInTheDocument();
    expect(screen.getAllByText(/reassessment/).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Upload document" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Save review" })).toBeNull();
    await waitFor(() => expect(apiRequest).not.toHaveBeenCalled());
    expect(uploadFileToSignedStorageUrl).not.toHaveBeenCalled();
  });

  it("shows unavailable deadlines and disables real dashboard actions", async () => {
    const user = userEvent.setup();
    render(<VisualPreview view="dashboard" />);
    const create = screen.getByRole("button", { name: "Analyse new tender" });
    expect(create).toBeDisabled();
    await user.click(create);
    expect(screen.getByText("No upcoming dates")).toBeInTheDocument();
    expect(screen.getAllByText("Deadline not provided")).toHaveLength(2);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
