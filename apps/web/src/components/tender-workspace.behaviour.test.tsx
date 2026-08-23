import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenderWorkspace } from "./tender-workspace";

const baseWorkspace = {
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
};

const inProgressWorkspace = {
  ...baseWorkspace,
  workflowState: {
    actionLabel: "Open",
    code: "EXTRACTING",
    detail: "Reading the current tender source.",
    isCompleted: false,
    isDraft: false,
    isInProgress: true,
    needsAttention: false,
    onHold: false,
    statusLabel: "Reading tender...",
    tone: "info",
  },
};

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((value) => {
    resolve = value;
  });
  return { promise, resolve };
}

const failedUploadWorkspace = {
  ...baseWorkspace,
  versions: [
    {
      documents: [
        {
          createdAt: "2026-08-20T09:30:00.000Z",
          displayFilename: "GeM-Bidding-9646270.pdf",
          id: "failed-document",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: "1024",
          status: "UPLOADING",
          uploadSessionExpiresAt: "2026-08-20T09:35:00.000Z",
        },
        {
          createdAt: "2026-08-20T10:00:00.000Z",
          displayFilename: "Ready-source.pdf",
          id: "ready-document",
          role: "ANNEXURE",
          sha256:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          sizeBytes: "2048",
          status: "READY",
          uploadSessionExpiresAt: "2026-08-20T10:05:00.000Z",
        },
      ],
      id: "version-1",
      reason: "Original tender source",
      versionNumber: 1,
    },
    {
      documents: [
        {
          createdAt: "2026-08-18T09:30:00.000Z",
          displayFilename: "Earlier-source.pdf",
          id: "older-document",
          role: "PRIMARY",
          sha256:
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          sizeBytes: "4096",
          status: "READY",
          uploadSessionExpiresAt: "2026-08-18T10:00:00.000Z",
        },
      ],
      id: "version-0",
      reason: "Superseded source set",
      versionNumber: 0,
    },
  ],
};

const { apiRequest, push, uploadFileToSignedStorageUrl } = vi.hoisted(() => ({
  apiRequest: vi.fn((path: string): unknown => {
    if (path.includes("/final-readiness?")) {
      return { items: [], next_cursor: null };
    }
    if (path.includes("/controlled-review-packages")) {
      return { items: [], next_cursor: null };
    }
    if (
      path.includes("/extractions") ||
      path.includes("/risk-analyses") ||
      path.includes("/eligibility-assessments") ||
      path.includes("/checklists") ||
      path.endsWith("/draft-generation-runs") ||
      path.endsWith("/drafts")
    ) {
      return [];
    }
    return baseWorkspace;
  }),
  push: vi.fn(),
  uploadFileToSignedStorageUrl: vi.fn(),
}));
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/tenders/org-1/tender-1",
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}));
vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("../lib/direct-upload", () => ({
  uploadFileToSignedStorageUrl,
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

beforeEach(() => {
  push.mockReset();
  apiRequest.mockClear();
  uploadFileToSignedStorageUrl.mockReset();
  search = new URLSearchParams();
  vi.unstubAllGlobals();
  vi.stubGlobal("File", window.File);
  vi.stubGlobal("FormData", window.FormData);
  vi.stubGlobal("crypto", {
    subtle: {
      digest: vi.fn(() => Promise.resolve(new Uint8Array(32).buffer)),
    },
  });
});

describe("tender workspace stages", () => {
  it("refreshes support data while authoritative workflow progress is active without overlapping calls", async () => {
    vi.useFakeTimers();
    try {
      const extractionDeferred = createDeferred<readonly []>();
      let extractionRequests = 0;

      apiRequest.mockImplementation((path: string): unknown => {
        if (path === "/organisations/org-1/tenders/tender-1") {
          return inProgressWorkspace;
        }
        if (path.includes("/final-readiness?")) {
          return { items: [], next_cursor: null };
        }
        if (path.includes("/controlled-review-packages")) {
          return { items: [], next_cursor: null };
        }
        if (path.endsWith("/versions/version-1/extractions")) {
          extractionRequests += 1;
          return extractionDeferred.promise;
        }
        if (
          path.endsWith("/versions/version-1/risk-analyses") ||
          path.endsWith("/versions/version-1/eligibility-assessments") ||
          path.endsWith("/versions/version-1/checklists") ||
          path.endsWith("/draft-generation-runs") ||
          path.endsWith("/drafts")
        ) {
          return [];
        }
        return [];
      });

      render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(extractionRequests).toBe(1));

      await vi.advanceTimersByTimeAsync(10_000);
      expect(extractionRequests).toBe(1);

      extractionDeferred.resolve([]);
      await vi.waitFor(() => expect(extractionRequests).toBe(1));

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(extractionRequests).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts at overview, exposes the new primary and secondary navigation, and updates the URL", async () => {
    const user = userEvent.setup();
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    await screen.findByText("Office equipment tender");
    expect(
      screen.getByRole("heading", { name: "Assessment summary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What needs your attention" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Eligibility" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI Chat" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tender Files" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Activity" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Eligibility" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/tenders/org-1/tender-1?stage=eligibility",
      ),
    );
  });

  it("maps legacy evidence and checklist stages into eligibility", async () => {
    search = new URLSearchParams("stage=evidence");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    await screen.findByRole("heading", { name: "Eligibility" });
    expect(screen.getByText("Evidence module mounted")).toBeInTheDocument();
    expect(screen.getByText("Checklist module mounted")).toBeInTheDocument();
  });

  it("maps legacy source routes into tender files", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("stage=sources");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    await screen.findByRole("heading", { name: "Tender Files" });
    await user.click(screen.getByRole("button", { name: "Upload files" }));
    expect(
      screen.getByRole("button", { name: "Upload source securely" }),
    ).toBeInTheDocument();
  });

  it("maps legacy risk routes safely back to overview", async () => {
    search = new URLSearchParams("stage=risks");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    expect(
      await screen.findByRole("heading", { name: "Assessment summary" }),
    ).toBeInTheDocument();
    const compatNote = document.querySelector(".tender-compat-note");
    expect(compatNote).toHaveTextContent(
      "This saved link used the legacy risks stage.",
    );
    expect(
      screen.queryByText("Readiness module mounted"),
    ).not.toBeInTheDocument();
  });

  it("mounts review and export from legacy readiness and export URLs", async () => {
    search = new URLSearchParams("stage=readiness");
    const view = render(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    await screen.findByRole("heading", { name: "Review & Export" });
    expect(screen.getByText("Readiness module mounted")).toBeInTheDocument();
    expect(screen.getByText("Export module mounted")).toBeInTheDocument();
    search = new URLSearchParams("stage=export");
    view.rerender(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    expect(
      await screen.findByRole("heading", { name: "Review & Export" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Readiness module mounted")).toBeInTheDocument();
    expect(screen.getByText("Export module mounted")).toBeInTheDocument();
  });

  it("follows stage changes supplied by browser back and forward navigation", async () => {
    search = new URLSearchParams("stage=readiness");
    const view = render(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    await screen.findByRole("heading", { name: "Review & Export" });
    search = new URLSearchParams("stage=draft");
    view.rerender(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    expect(
      await screen.findByRole("heading", { name: "Draft" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Assessment summary" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("Drafting is currently blocked"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Readiness module mounted"),
    ).not.toBeInTheDocument();
    search = new URLSearchParams("stage=readiness");
    view.rerender(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    expect(
      await screen.findByRole("heading", { name: "Review & Export" }),
    ).toBeInTheDocument();
  });

  it("retains the safe overview fallback for an unsupported stage", async () => {
    search = new URLSearchParams("stage=submission");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    expect(
      await screen.findByRole("heading", { name: "Assessment summary" }),
    ).toBeInTheDocument();
    const compatNote = document.querySelector(".tender-compat-note");
    expect(compatNote).toHaveTextContent(
      "This saved link used the legacy submission stage.",
    );
    expect(
      screen.queryByText("Readiness module mounted"),
    ).not.toBeInTheDocument();
  });

  it("renders AI chat safely when controlled package history is empty in the live envelope shape", async () => {
    search = new URLSearchParams("stage=ask");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    expect(
      await screen.findByRole("heading", { name: "AI Chat" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ask module mounted")).toBeInTheDocument();
  });

  it("renders controlled package activity entries from the live history envelope shape", async () => {
    apiRequest.mockImplementation((path: string): unknown => {
      if (path.includes("/final-readiness?")) {
        return { items: [], next_cursor: null };
      }
      if (path.includes("/controlled-review-packages")) {
        return {
          items: [
            {
              artifact_id: "artifact-1",
              created_at: "2026-08-20T09:30:00.000Z",
              freshness: "CURRENT",
              generation_status: "PACKAGE_READY",
              id: "pkg-1",
              is_current: true,
              review_status: "HUMAN_REVIEW_REQUIRED",
            },
          ],
          next_cursor: null,
        };
      }
      if (
        path.includes("/extractions") ||
        path.includes("/risk-analyses") ||
        path.includes("/eligibility-assessments") ||
        path.includes("/checklists") ||
        path.endsWith("/draft-generation-runs") ||
        path.endsWith("/drafts")
      ) {
        return [];
      }
      return baseWorkspace;
    });
    search = new URLSearchParams("stage=activity");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    expect(
      await screen.findByRole("heading", { name: "Activity" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Controlled review package Package ready"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Human review required review state."),
    ).toBeInTheDocument();
  });

  it("shows a direct failed-upload trash action, confirms removal, and keeps ready-row actions direct", async () => {
    const user = userEvent.setup();
    let workspaceState = structuredClone(failedUploadWorkspace);

    apiRequest.mockImplementation(
      (path: string, init?: RequestInit): unknown => {
        if (path.includes("/final-readiness?")) {
          return { items: [], next_cursor: null };
        }
        if (path.includes("/controlled-review-packages")) {
          return { items: [], next_cursor: null };
        }
        if (
          path.includes("/extractions") ||
          path.includes("/risk-analyses") ||
          path.includes("/eligibility-assessments") ||
          path.includes("/checklists") ||
          path.endsWith("/draft-generation-runs") ||
          path.endsWith("/drafts")
        ) {
          return [];
        }
        if (
          path.endsWith("/documents/failed-document") &&
          init?.method === "DELETE"
        ) {
          workspaceState = {
            ...workspaceState,
            versions: workspaceState.versions.map((version) => ({
              ...version,
              documents: version.documents.filter(
                (document) => document.id !== "failed-document",
              ),
            })),
          };
          return { removed: true };
        }
        return workspaceState;
      },
    );

    search = new URLSearchParams("stage=files");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("heading", { name: "Tender Files" }),
    ).toBeInTheDocument();
    expect(screen.getByText("GeM-Bidding-9646270.pdf")).toBeInTheDocument();
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Remove failed upload GeM-Bidding-9646270.pdf",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Actions for GeM-Bidding-9646270.pdf",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download Ready-source.pdf" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Remove failed upload Ready-source.pdf",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Actions for Ready-source.pdf",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tender version")).not.toBeInTheDocument();
    expect(screen.getByText("Previous source history")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Remove failed upload GeM-Bidding-9646270.pdf",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Remove failed upload" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Remove this failed upload? You can upload the file again afterwards.",
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Remove file",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("GeM-Bidding-9646270.pdf"),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(
        "Failed upload removed. The same file can now be uploaded again.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a direct ready-file trash action for a current single-source row and removes it after confirmation", async () => {
    const user = userEvent.setup();
    let workspaceState = {
      ...baseWorkspace,
      versions: [
        {
          documents: [
            {
              createdAt: "2026-08-20T10:00:00.000Z",
              displayFilename: "GeM-Bidding-9646270.pdf",
              id: "ready-document",
              role: "PRIMARY",
              sha256:
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              sizeBytes: "2048",
              status: "READY",
              uploadSessionExpiresAt: "2026-08-20T10:05:00.000Z",
            },
          ],
          id: "version-1",
          reason: "Original tender source",
          versionNumber: 1,
        },
      ],
    };

    apiRequest.mockImplementation(
      (path: string, init?: RequestInit): unknown => {
        if (path.includes("/final-readiness?")) {
          return { items: [], next_cursor: null };
        }
        if (path.includes("/controlled-review-packages")) {
          return { items: [], next_cursor: null };
        }
        if (
          path.includes("/extractions") ||
          path.includes("/risk-analyses") ||
          path.includes("/eligibility-assessments") ||
          path.includes("/checklists") ||
          path.endsWith("/draft-generation-runs") ||
          path.endsWith("/drafts")
        ) {
          return [];
        }
        if (
          path.endsWith("/documents/ready-document") &&
          init?.method === "DELETE"
        ) {
          workspaceState = {
            ...workspaceState,
            versions: workspaceState.versions.map((version) => ({
              ...version,
              documents: version.documents.filter(
                (document) => document.id !== "ready-document",
              ),
            })),
          };
          return { removed: true };
        }
        return workspaceState;
      },
    );

    search = new URLSearchParams("stage=files");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("heading", { name: "Tender Files" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Download GeM-Bidding-9646270.pdf",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Remove tender file GeM-Bidding-9646270.pdf",
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Remove tender file GeM-Bidding-9646270.pdf",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Remove this tender file?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Removing a processed source may invalidate analysis, eligibility, draft, AI index, and review results derived from it.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove file" }));

    await waitFor(() =>
      expect(
        screen.queryByText("GeM-Bidding-9646270.pdf"),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(
        "Tender file removed. You can upload the same file again.",
      ),
    ).toBeInTheDocument();
  });

  it("abandons a failed direct upload before completion and allows a clean retry", async () => {
    const user = userEvent.setup();
    let uploadSessionCount = 0;

    apiRequest.mockImplementation(
      (path: string, init?: RequestInit): unknown => {
        if (path === "/organisations/org-1/tenders/tender-1") {
          return baseWorkspace;
        }
        if (path.includes("/final-readiness?")) {
          return { items: [], next_cursor: null };
        }
        if (path.includes("/controlled-review-packages")) {
          return { items: [], next_cursor: null };
        }
        if (
          path.includes("/extractions") ||
          path.includes("/risk-analyses") ||
          path.includes("/eligibility-assessments") ||
          path.includes("/checklists") ||
          path.endsWith("/draft-generation-runs") ||
          path.endsWith("/drafts")
        ) {
          return [];
        }
        if (
          path ===
            "/organisations/org-1/tenders/tender-1/versions/version-1/upload-sessions" &&
          init?.method === "POST"
        ) {
          uploadSessionCount += 1;
          return {
            document_id: `upload-document-${uploadSessionCount}`,
            upload_url: `http://storage.local/upload-${uploadSessionCount}`,
          };
        }
        if (
          path ===
            "/organisations/org-1/tenders/tender-1/documents/upload-document-1" &&
          init?.method === "DELETE"
        ) {
          return { removed: true };
        }
        if (
          path ===
            "/organisations/org-1/tenders/tender-1/documents/upload-document-2/complete" &&
          init?.method === "POST"
        ) {
          return { job_id: "job-2", state: "QUEUED" };
        }
        return baseWorkspace;
      },
    );

    uploadFileToSignedStorageUrl.mockRejectedValueOnce(new Error("blocked"));
    uploadFileToSignedStorageUrl.mockResolvedValueOnce(undefined);

    search = new URLSearchParams("stage=files");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    await screen.findByRole("heading", { name: "Tender Files" });
    await user.click(screen.getByRole("button", { name: "Upload files" }));

    const dialog = screen.getByRole("dialog", { name: "Upload tender files" });
    const file = new File(["%PDF-1.4"], "tender.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(new TextEncoder().encode("%PDF-1.4").buffer),
    });
    const NativeFormData = window.FormData;
    class MockFormData extends NativeFormData {
      public override getAll(name: string): FormDataEntryValue[] {
        if (name === "file") return [file];
        return super.getAll(name);
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
      throw new Error("Expected tender upload file input");
    }

    await user.upload(fileInput, file);
    expect(fileInput.files).toHaveLength(1);
    fireEvent.submit(form);

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/tenders/tender-1/versions/version-1/upload-sessions",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/tenders/tender-1/documents/upload-document-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(
      await screen.findByText(
        'The direct upload of "tender.pdf" was rejected before it reached secure storage.',
      ),
    ).toBeInTheDocument();

    fireEvent.submit(form);

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/tenders/tender-1/documents/upload-document-2/complete",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Upload tender files" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("prefers current extracted support data over a stale workflow summary and uses truthful extraction wording", async () => {
    apiRequest.mockImplementation((path: string): unknown => {
      if (path === "/organisations/org-1/tenders/tender-1") {
        return {
          ...baseWorkspace,
          versions: [
            {
              documents: [
                {
                  createdAt: "2026-08-22T09:30:00.000Z",
                  displayFilename: "Synthetic_GeM_Tender_Test.pdf",
                  id: "ready-document",
                  role: "PRIMARY",
                  sha256:
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  sizeBytes: "4096",
                  status: "READY",
                  uploadSessionExpiresAt: "2026-08-22T10:00:00.000Z",
                },
              ],
              id: "version-1",
              reason: "Original tender source",
              versionNumber: 1,
            },
          ],
          workflowState: {
            actionLabel: "Open",
            code: "EXTRACTING",
            detail: "Reading the current tender source.",
            isCompleted: false,
            isDraft: false,
            isInProgress: false,
            needsAttention: false,
            onHold: false,
            statusLabel: "Reading tender...",
            tone: "info",
          },
        };
      }
      if (path.includes("/final-readiness?")) {
        return { items: [], next_cursor: null };
      }
      if (path.includes("/controlled-review-packages")) {
        return { items: [], next_cursor: null };
      }
      if (path.endsWith("/versions/version-1/extractions")) {
        return [
          {
            current_stage: "COMPLETE",
            id: "extract-1",
            parser_policy_version: "parser-v1",
            progress_percentage: 100,
            public_message: "Extraction complete",
            quality_summary: {},
            source_fingerprint: "fingerprint-a",
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/versions/version-1/risk-analyses")) {
        return [];
      }
      if (
        path.endsWith("/versions/version-1/eligibility-assessments") ||
        path.endsWith("/versions/version-1/checklists") ||
        path.endsWith("/draft-generation-runs") ||
        path.endsWith("/drafts")
      ) {
        return [];
      }
      if (path.endsWith("/extractions/extract-1/requirements")) {
        return [
          {
            category: "DELIVERY",
            citations: [],
            confidence: "HIGH",
            findingState: "SUPPORTED",
            id: "requirement-1",
            normalizedStatement: "Complete the work within 90 days.",
            obligation: "MANDATORY",
            reviewState: "UNREVIEWED",
            sourceWording: "Complete the work within 90 days.",
            title: "Delivery timeline",
          },
        ];
      }
      if (
        path.endsWith("/extractions/extract-1/fields") ||
        path.endsWith("/extractions/extract-1/issues")
      ) {
        return [];
      }
      return [];
    });

    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("heading", { name: "Assessment summary" }),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Risk analysis not started"))[0],
    ).toBeVisible();
    expect(screen.queryByText("Reading tender...")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Automatic progression will retry/i),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: "View extracted requirements",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });
});
