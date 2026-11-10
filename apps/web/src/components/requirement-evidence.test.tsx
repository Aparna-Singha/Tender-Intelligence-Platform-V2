import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequirementEvidence } from "./requirement-evidence";
import { PublicApiError } from "../lib/api";
import type * as ApiModule from "../lib/api";

const { apiRequest, uploadFileToSignedStorageUrl } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  uploadFileToSignedStorageUrl: vi.fn(),
}));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiRequest,
}));
vi.mock("../lib/direct-upload", () => ({ uploadFileToSignedStorageUrl }));

function delegateRequest(
  original: ReturnType<typeof apiRequest.getMockImplementation>,
  path: string,
  options?: { method?: string },
): Promise<unknown> {
  if (!original) throw new Error("Original request mock is missing");
  return original(path, options) as Promise<unknown>;
}

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
  document_version_id: string;
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
  document_version_id: "version-1",
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
    vi.spyOn(window, "open").mockReturnValue(null);
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

  it("downloads the attached V1 even when the document candidate has current V2", async () => {
    rows = [{ ...attachment("historical"), document_version_id: "version-v1" }];
    const regularRequest = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) =>
        path.includes("/evidence-candidates")
          ? Promise.resolve({
              items: [
                {
                  id: "historical-document",
                  displayName: "Udyam certificate",
                  status: "READY",
                  verificationStatus: "UNVERIFIED",
                  expiryDate: null,
                  currentVersion: { id: "version-v2", versionNumber: 2 },
                },
              ],
            })
          : path.endsWith("/attachments/historical/download")
            ? Promise.resolve({
                download_url: "https://private.example/signed-v1",
                document_version_id: "version-v1",
                expires_in_seconds: 60,
              })
            : delegateRequest(regularRequest, path, options),
    );
    render(<RequirementEvidence {...scope} />);
    expect(await screen.findByText("historical")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose existing document" }),
    );
    expect(await screen.findByText("Udyam certificate")).toBeInTheDocument();
    expect(screen.getByText(/Version 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Download attached version" }),
    );
    const link = await screen.findByRole("link", {
      name: "Open download link",
    });
    expect(link).toHaveAttribute("href", "https://private.example/signed-v1");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(apiRequest).toHaveBeenCalledWith(
      "/organisations/org/tenders/tender/versions/version/requirements/requirement-4/attachments/historical/download",
      { method: "POST" },
    );
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
  });

  it("refuses a signed URL for a different version", async () => {
    rows = [attachment("historical")];
    const regularRequest = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) =>
        path.endsWith("/download")
          ? Promise.resolve({
              download_url: "https://private.example/wrong-version",
              document_version_id: "version-2",
              expires_in_seconds: 60,
            })
          : delegateRequest(regularRequest, path, options),
    );
    render(<RequirementEvidence {...scope} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Download attached version" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("did not match");
    expect(
      screen.queryByRole("link", { name: "Open download link" }),
    ).toBeNull();
  });

  it.each([
    [401, "Your session has expired. Please log in again."],
    [403, "You do not have permission to download this attachment."],
  ])(
    "shows authorization failure %i without opening a link",
    async (status, message) => {
      rows = [attachment("restricted")];
      const regularRequest = apiRequest.getMockImplementation();
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) =>
          path.endsWith("/download")
            ? Promise.reject(
                new PublicApiError(message, status, `HTTP_${status}`),
              )
            : delegateRequest(regularRequest, path, options),
      );
      render(<RequirementEvidence {...scope} />);
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Download attached version",
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByRole("link", { name: "Open download link" }),
      ).toBeNull();
    },
  );

  it("rejects an expired signed link", async () => {
    rows = [attachment("expired-link")];
    const regularRequest = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) =>
        path.endsWith("/download")
          ? Promise.resolve({
              download_url: "https://private.example/expired",
              document_version_id: "version-1",
              expires_in_seconds: 0,
            })
          : delegateRequest(regularRequest, path, options),
    );
    render(<RequirementEvidence {...scope} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Download attached version" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invalid or expired",
    );
    expect(
      screen.queryByRole("link", { name: "Open download link" }),
    ).toBeNull();
  });

  it("reports a download service error and leaves the action retryable", async () => {
    rows = [attachment("retry")];
    const regularRequest = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) =>
        path.endsWith("/download")
          ? Promise.reject(new Error("synthetic network failure"))
          : delegateRequest(regularRequest, path, options),
    );
    render(<RequirementEvidence {...scope} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Download attached version" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Download failed. Please retry.",
    );
    expect(
      screen.getByRole("button", { name: "Download attached version" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("link", { name: "Open download link" }),
    ).toBeNull();
  });
});
