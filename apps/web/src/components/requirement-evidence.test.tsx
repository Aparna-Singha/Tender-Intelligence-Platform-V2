import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequirementEvidence } from "./requirement-evidence";

const { apiRequest, uploadFileToSignedStorageUrl } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  uploadFileToSignedStorageUrl: vi.fn(),
}));
vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("../lib/direct-upload", () => ({ uploadFileToSignedStorageUrl }));

const scope = {
  organisationId: "org",
  tenderId: "tender",
  versionId: "version",
  requirementId: "requirement-4",
};
const attachment = (
  id: string,
): {
  attachment_id: string;
  context_only: boolean;
  detached_at: null;
  stale_requirement: boolean;
  document: {
    displayName: string;
    status: string;
    verificationStatus: string;
    expiryDate: string | null;
  };
  version: { originalFilename: string; uploadSession: null };
} => ({
  attachment_id: id,
  context_only: true,
  detached_at: null,
  stale_requirement: false,
  document: {
    displayName: id,
    status: "READY",
    verificationStatus: "UNVERIFIED",
    expiryDate: null,
  },
  version: { originalFilename: `${id}.pdf`, uploadSession: null },
});

describe("requirement evidence actions", () => {
  let rows: ReturnType<typeof attachment>[];
  beforeEach(() => {
    rows = [];
    apiRequest.mockReset();
    uploadFileToSignedStorageUrl.mockReset();
    uploadFileToSignedStorageUrl.mockResolvedValue(undefined);
    vi.stubGlobal("crypto", {
      randomUUID: () => "idempotency-key",
      subtle: {
        digest: () => Promise.resolve(new Uint8Array(32).buffer),
      },
    });
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        expect(path).toContain("/requirements/requirement-4/");
        if (path.endsWith("/attachments") && !options?.method)
          return Promise.resolve([...rows]);
        if (path.includes("/evidence-candidates"))
          return Promise.resolve({
            items: [
              {
                id: "existing",
                displayName: "Udyam certificate",
                status: "READY",
                verificationStatus: "UNVERIFIED",
                expiryDate: null,
                currentVersion: { id: "version-1", versionNumber: 1 },
              },
            ],
          });
        if (path.endsWith("/upload-sessions")) {
          rows.push(attachment("uploaded"));
          return Promise.resolve({
            attachment_id: "uploaded",
            upload_session_id: "session",
            upload_url: "https://private.example/upload",
          });
        }
        if (path.endsWith("/complete"))
          return Promise.resolve({ status: "UPLOADED" });
        if (path.endsWith("/attachments") && options?.method === "POST") {
          rows.push(attachment("existing"));
          return Promise.resolve({ attachment_id: "existing" });
        }
        if (
          path.endsWith("/attachments/existing") &&
          options?.method === "DELETE"
        ) {
          rows = rows.filter((row) => row.attachment_id !== "existing");
          return Promise.resolve({ detached: true });
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
  });

  it("shows synthetic attachments without loading or permitting changes", () => {
    render(
      <RequirementEvidence
        {...scope}
        canEdit={false}
        previewItems={[attachment("Synthetic certificate")]}
      />,
    );
    expect(screen.getByText("Synthetic certificate")).toBeVisible();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Upload document" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Detach" })).toBeNull();
  });

  it("uploads directly under the chosen requirement and reads persistence", async () => {
    render(<RequirementEvidence {...scope} />);
    const file = new File(["synthetic PDF"], "evidence.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(new Uint8Array([1]).buffer),
    });
    fireEvent.change(screen.getByLabelText("Upload evidence document"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("uploaded")).toBeInTheDocument();
    await waitFor(() =>
      expect(uploadFileToSignedStorageUrl).toHaveBeenCalledOnce(),
    );
    expect(
      apiRequest.mock.calls.some(
        ([path]) => typeof path === "string" && path.endsWith("/complete"),
      ),
    ).toBe(true);
  });

  it("selects and detaches an existing version without uploading", async () => {
    render(<RequirementEvidence {...scope} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Choose existing document" }),
    );
    expect(await screen.findByText("Udyam certificate")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(await screen.findByText("existing")).toBeInTheDocument();
    expect(uploadFileToSignedStorageUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    await waitFor(() => expect(screen.queryByText("existing")).toBeNull());
  });

  it("rejects unsupported files before creating an upload session", async () => {
    render(<RequirementEvidence {...scope} />);
    fireEvent.change(screen.getByLabelText("Upload evidence document"), {
      target: {
        files: [new File(["text"], "unsafe.txt", { type: "text/plain" })],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("not supported");
    expect(
      apiRequest.mock.calls.some(
        ([path]) =>
          typeof path === "string" && path.endsWith("/upload-sessions"),
      ),
    ).toBe(false);
  });

  it("labels expired and unverified documents without claiming compliance", async () => {
    rows = [
      {
        ...attachment("expired"),
        document: {
          displayName: "Expired certificate",
          status: "READY",
          verificationStatus: "UNVERIFIED",
          expiryDate: "2020-01-01T00:00:00.000Z",
        },
      },
    ];
    render(<RequirementEvidence {...scope} />);
    expect(await screen.findByText("Expired certificate")).toBeInTheDocument();
    expect(screen.getByText(/Not independently verified/)).toBeInTheDocument();
    expect(screen.getByText(/· Expired$/)).toBeInTheDocument();
    expect(screen.getByText(/not proof of eligibility/)).toBeInTheDocument();
  });
});
