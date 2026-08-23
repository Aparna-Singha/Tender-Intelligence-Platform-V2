import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentCentre } from "./document-centre";

const { apiRequest, uploadFileToSignedStorageUrl } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  uploadFileToSignedStorageUrl: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  PublicApiError: class PublicApiError extends Error {},
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("../lib/direct-upload", () => ({
  uploadFileToSignedStorageUrl,
}));

describe("company docs workspace", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    apiRequest.mockReset();
    uploadFileToSignedStorageUrl.mockReset();
    vi.restoreAllMocks();
    vi.stubGlobal("File", window.File);
    vi.stubGlobal("FormData", window.FormData);
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(() => Promise.resolve(new Uint8Array(32).buffer)),
      },
    });
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
            status: "READY",
            updatedAt: "2026-08-18T10:00:00.000Z",
            verificationStatus: "HUMAN_REVIEW_REQUIRED",
          },
          {
            category: "ISO_CERTIFICATE",
            displayName: "ISO certificate",
            expiryDate: null,
            id: "doc-3",
            status: "READY",
            updatedAt: "2026-08-17T10:00:00.000Z",
            verificationStatus: "UNVERIFIED",
          },
          {
            category: "LICENCE",
            displayName: "Factory licence",
            expiryDate: null,
            id: "doc-4",
            status: "READY",
            updatedAt: "2026-08-16T10:00:00.000Z",
            verificationStatus: "REJECTED",
          },
          {
            category: "PURCHASE_ORDER",
            displayName: "Purchase order",
            expiryDate: null,
            id: "doc-5",
            status: "QUARANTINED",
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
    expect(
      await screen.findByRole("heading", { name: "Company documents" }),
    ).toBeInTheDocument();
    const summaryGrid = screen
      .getByText("Current")
      .closest(".tender-summary-grid");
    expect(summaryGrid).toBeInstanceOf(HTMLElement);
    if (!(summaryGrid instanceof HTMLElement)) {
      throw new Error("Expected health summary grid to render");
    }
    const summary = within(summaryGrid);
    const currentCard = summary.getByText("Current").closest("div");
    const attentionCard = summary.getByText("Need attention").closest("div");
    const expiringCard = summary.getByText("Expiring soon").closest("div");
    const outdatedCard = summary.getByText("Outdated").closest("div");
    const tableCard = screen
      .getByRole("table")
      .closest(".company-docs-table-card");
    expect(currentCard).toHaveTextContent("1");
    expect(attentionCard).toHaveTextContent("4");
    expect(expiringCard).toHaveTextContent("1");
    expect(outdatedCard).toHaveTextContent("0");
    expect(
      screen.getByText(/Evidence health needs review|Expiry review coming up/),
    ).toBeInTheDocument();
    expect(screen.getByText("All documents")).toBeInTheDocument();
    expect(screen.getByText("GST certificate")).toBeInTheDocument();
    expect(tableCard).toBeInstanceOf(HTMLElement);
    if (!(tableCard instanceof HTMLElement)) {
      throw new Error("Expected document table card to render");
    }
    const table = within(tableCard);
    expect(table.getByText("Factory licence")).toBeInTheDocument();
    expect(table.getAllByText("Purchase order").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("Human review required")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(table.getByText("Quarantined")).toBeInTheDocument();
  });

  it("shows truthful supported-type guidance in the upload modal", async () => {
    const user = userEvent.setup();
    render(<DocumentCentre organisationId="org-1" />);
    await screen.findByRole("heading", { name: "Company documents" });
    await user.click(
      screen.getAllByRole("button", { name: "Upload document" })[0]!,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Upload company document",
    });
    const fileInput = dialog.querySelector('input[type="file"]');
    expect(dialog).toHaveTextContent(
      "PDF, JPG/JPEG, PNG, DOCX, or XLSX up to 25 MB.",
    );
    expect(fileInput).toHaveAttribute(
      "accept",
      ".pdf,.jpg,.jpeg,.png,.docx,.xlsx",
    );
    expect(within(dialog).getByRole("combobox")).toHaveValue("UDYAM");
  });

  it("abandons a failed direct upload before completion and allows a clean retry", async () => {
    const user = userEvent.setup();
    let createCount = 0;
    let documents: readonly unknown[] = [];

    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/organisations/org-1/documents") {
        return Promise.resolve(documents);
      }
      if (
        path === "/organisations/org-1/documents/upload-sessions" &&
        init?.method === "POST"
      ) {
        createCount += 1;
        return Promise.resolve({
          document_id: `doc-${createCount}`,
          upload_session_id: `session-${createCount}`,
          upload_url: `http://storage.local/upload-${createCount}`,
        });
      }
      if (
        path === "/organisations/org-1/documents/upload-sessions/session-1" &&
        init?.method === "DELETE"
      ) {
        return Promise.resolve({ removed: true });
      }
      if (
        path ===
          "/organisations/org-1/documents/upload-sessions/session-2/complete" &&
        init?.method === "POST"
      ) {
        documents = [
          {
            category: "UDYAM",
            displayName: "udyam.pdf",
            expiryDate: null,
            id: "doc-2",
            status: "READY",
            updatedAt: "2026-08-22T09:00:00.000Z",
            verificationStatus: "UNVERIFIED",
          },
        ];
        return Promise.resolve({ document_id: "doc-2", status: "UPLOADED" });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    uploadFileToSignedStorageUrl.mockRejectedValueOnce(
      new Error("storage down"),
    );
    uploadFileToSignedStorageUrl.mockResolvedValueOnce(undefined);

    render(<DocumentCentre organisationId="org-1" />);
    await screen.findByRole("heading", { name: "Company documents" });
    await user.click(
      screen.getAllByRole("button", { name: "Upload document" })[0]!,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Upload company document",
    });
    const file = new File(["evidence"], "udyam.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(new TextEncoder().encode("evidence").buffer),
    });
    const NativeFormData = window.FormData;
    class MockFormData extends NativeFormData {
      public override get(name: string): FormDataEntryValue | null {
        if (name === "file") return file;
        return super.get(name);
      }
    }
    vi.stubGlobal("FormData", MockFormData);
    Object.defineProperty(window, "FormData", {
      configurable: true,
      value: MockFormData,
    });
    const fileInput = dialog.querySelector('input[type="file"]');
    const form = dialog.querySelector("form");
    expect(fileInput).toBeInstanceOf(HTMLInputElement);
    expect(form).not.toBeNull();
    if (!(fileInput instanceof HTMLInputElement) || form === null) {
      throw new Error("Expected company document upload form");
    }

    await user.upload(fileInput, file);
    fireEvent.submit(form);

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/documents/upload-sessions/session-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(
      await within(dialog).findByText(
        "Upload to secure storage failed. Please try again.",
      ),
    ).toBeInTheDocument();

    fireEvent.submit(form);

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/documents/upload-sessions/session-2/complete",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Upload company document" }),
      ).not.toBeInTheDocument(),
    );
  });
});
