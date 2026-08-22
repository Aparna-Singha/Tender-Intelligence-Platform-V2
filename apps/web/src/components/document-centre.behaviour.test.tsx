import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentCentre } from "./document-centre";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

describe("company docs workspace", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    vi.restoreAllMocks();
    apiRequest.mockImplementation((path: string) => {
      if (path === "/organisations/org-1/documents") {
        return Promise.resolve([
          {
            category: "GST",
            displayName: "GST certificate",
            expiryDate: "2026-09-05T00:00:00.000Z",
            id: "doc-1",
            status: "READY",
            updatedAt: "2026-08-19T12:00:00.000Z",
            verificationStatus: "VERIFIED",
          },
          {
            category: "PAN",
            displayName: "PAN copy",
            expiryDate: null,
            id: "doc-2",
            status: "QUARANTINED",
            updatedAt: "2026-08-18T10:00:00.000Z",
            verificationStatus: "PENDING_REVIEW",
          },
          {
            category: "ISO_CERTIFICATE",
            displayName: "ISO certificate",
            expiryDate: "2026-08-01T00:00:00.000Z",
            id: "doc-3",
            status: "READY",
            updatedAt: "2026-08-15T10:00:00.000Z",
            verificationStatus: "VERIFIED",
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  it("renames the surface to Company documents and derives health counts from real document state", async () => {
    render(<DocumentCentre organisationId="org-1" />);
    expect(await screen.findByRole("heading", { name: "Company documents" })).toBeInTheDocument();
    const summaryGrid = screen.getByText("Current").closest(".tender-summary-grid");
    expect(summaryGrid).toBeInstanceOf(HTMLElement);
    if (!(summaryGrid instanceof HTMLElement)) {
      throw new Error("Expected health summary grid to render");
    }
    const summary = within(summaryGrid);
    expect(summary.getByText("Current")).toBeInTheDocument();
    expect(summary.getByText("Need attention")).toBeInTheDocument();
    expect(summary.getByText("Expiring soon")).toBeInTheDocument();
    expect(summary.getByText("Outdated")).toBeInTheDocument();
    expect(summary.getAllByText("1", { selector: "strong" })).toHaveLength(4);
    expect(screen.getByText(/Evidence health needs review|Expiry review coming up/)).toBeInTheDocument();
    expect(screen.getByText("All documents")).toBeInTheDocument();
    expect(screen.getByText("GST certificate")).toBeInTheDocument();
  });

  it("shows truthful supported-type guidance in the upload modal", async () => {
    const user = userEvent.setup();
    render(<DocumentCentre organisationId="org-1" />);
    await screen.findByRole("heading", { name: "Company documents" });
    await user.click(screen.getAllByRole("button", { name: "Upload document" })[0]!);

    const dialog = screen.getByRole("dialog", { name: "Upload company document" });
    const fileInput = dialog.querySelector('input[type="file"]');
    expect(dialog).toHaveTextContent("PDF, JPG/JPEG, PNG, DOCX, or XLSX up to 25 MB.");
    expect(fileInput).toHaveAttribute("accept", ".pdf,.jpg,.jpeg,.png,.docx,.xlsx");
    expect(within(dialog).getByRole("combobox")).toHaveValue("UDYAM");
  });
});
