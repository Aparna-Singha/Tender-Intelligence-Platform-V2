import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

const {
  apiRequest,
  captureActionChecklistProps,
  captureEvidenceMatrixProps,
  push,
  uploadFileToSignedStorageUrl,
} = vi.hoisted(() => ({
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
  captureActionChecklistProps: vi.fn(),
  captureEvidenceMatrixProps: vi.fn(),
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
  EvidenceMatrix: (props: unknown) => {
    captureEvidenceMatrixProps(props);
    return <div>Evidence module mounted</div>;
  },
}));
vi.mock("./action-checklist", () => ({
  ActionChecklist: (props: { presentation?: "full" | "history" }) => {
    captureActionChecklistProps(props);
    return (
      <div>
        {props.presentation === "history"
          ? "Checklist history module mounted"
          : "Checklist module mounted"}
      </div>
    );
  },
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
  captureActionChecklistProps.mockReset();
  captureEvidenceMatrixProps.mockReset();
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
  it("queues a fresh support reload after an in-flight authoritative refresh finishes", async () => {
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
      await vi.waitFor(() => expect(extractionRequests).toBeGreaterThan(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts at overview, exposes the new primary and secondary navigation, and updates the URL", async () => {
    const user = userEvent.setup();
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    await screen.findByText("Office equipment tender");
    expect(
      screen.getByRole("heading", { name: "What matters now" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Top blockers and follow-ups" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Pursuit decision", level: 2 }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Requirements/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI Chat" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tender Files" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Activity" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Requirements/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/tenders/org-1/tender-1?stage=eligibility",
      ),
    );
  });

  it("maps legacy evidence and checklist stages into eligibility", async () => {
    search = new URLSearchParams("stage=evidence");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    await screen.findByRole("heading", { name: /Requirements/i });
    expect(screen.getByText("Audit & evidence")).toBeInTheDocument();
    expect(screen.getByText("Evidence module mounted")).toBeInTheDocument();
    expect(
      screen.getByText("Checklist history module mounted"),
    ).toBeInTheDocument();
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
      await screen.findByRole("heading", { name: "What matters now" }),
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
    await screen.findByRole("heading", { name: "Final Review" });
    expect(screen.getByText("Readiness module mounted")).toBeInTheDocument();
    expect(screen.getByText("Export module mounted")).toBeInTheDocument();
    search = new URLSearchParams("stage=export");
    view.rerender(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    expect(
      await screen.findByRole("heading", { name: "Final Review" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Readiness module mounted")).toBeInTheDocument();
    expect(screen.getByText("Export module mounted")).toBeInTheDocument();
  });

  it("follows stage changes supplied by browser back and forward navigation", async () => {
    search = new URLSearchParams("stage=readiness");
    const view = render(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    await screen.findByRole("heading", { name: "Final Review" });
    search = new URLSearchParams("stage=draft");
    view.rerender(
      <TenderWorkspace organisationId="org-1" tenderId="tender-1" />,
    );
    expect(
      await screen.findByRole("heading", { name: "Draft" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "What matters now" }),
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
      await screen.findByRole("heading", { name: "Final Review" }),
    ).toBeInTheDocument();
  });

  it("retains the safe overview fallback for an unsupported stage", async () => {
    search = new URLSearchParams("stage=submission");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);
    expect(
      await screen.findByRole("heading", { name: "What matters now" }),
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

  it("renders AI chat safely when the current eligibility run omits snapshot metadata", async () => {
    apiRequest.mockImplementation((path: string): unknown => {
      if (path.includes("/final-readiness?")) {
        return { items: [], next_cursor: null };
      }
      if (path.includes("/controlled-review-packages")) {
        return { items: [], next_cursor: null };
      }
      if (
        path.endsWith("/versions/version-1/eligibility-assessments/current")
      ) {
        return {
          id: "assessment-1",
          invalidatedAt: null,
          progressPercentage: 60,
          publicMessage: "Comparison running",
          status: "RUNNING",
        };
      }
      if (
        path.includes("/extractions") ||
        path.includes("/risk-analyses") ||
        path.endsWith("/versions/version-1/eligibility-assessments") ||
        path.includes("/checklists") ||
        path.endsWith("/draft-generation-runs") ||
        path.endsWith("/drafts")
      ) {
        return [];
      }
      return baseWorkspace;
    });

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
      await screen.findByText("Review package Package ready"),
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

  it("keeps the authoritative workflow summary while still surfacing extracted support details", async () => {
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
      await screen.findByRole("heading", { name: "What matters now" }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText("Reading tender..."))[0]).toBeVisible();
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

  it("uses plain-language waiting copy when eligibility is blocked on a Continue decision", async () => {
    search = new URLSearchParams("stage=eligibility");
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
        return [
          {
            created_at: "2026-08-22T10:30:00.000Z",
            id: "risk-1",
            is_current: true,
            safeFailureMessage: null,
            status: "COMPLETE",
          },
        ];
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
      await screen.findByRole("heading", { name: /Requirements/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Review pursuit decision/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Missing items and actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/current tender version finishes extracting/i),
    ).not.toBeInTheDocument();
  });

  it("keeps support current after Continue so overview updates without a manual reload", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    try {
      let currentAssessmentPolls = 0;
      const workspaceState = {
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
          code: "ASSESSMENT_NOT_STARTED",
          detail:
            "Eligibility will start automatically for the latest Continue decision.",
          isCompleted: false,
          isDraft: false,
          isInProgress: false,
          needsAttention: false,
          onHold: false,
          statusLabel: "Eligibility is starting",
          tone: "info",
        },
      };

      apiRequest.mockImplementation((path: string): unknown => {
        if (path === "/organisations/org-1/tenders/tender-1") {
          return workspaceState;
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
              source_fingerprint: "fingerprint-a",
              status: "COMPLETE",
            },
          ];
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
        if (path.endsWith("/versions/version-1/risk-analyses/current")) {
          return {
            created_at: "2026-08-22T10:30:00.000Z",
            id: "risk-1",
            is_current: true,
            safeFailureMessage: null,
            status: "COMPLETE",
          };
        }
        if (path.endsWith("/versions/version-1/risk-analyses")) {
          return [
            {
              created_at: "2026-08-22T10:30:00.000Z",
              id: "risk-1",
              is_current: true,
              safeFailureMessage: null,
              status: "COMPLETE",
            },
          ];
        }
        if (path.endsWith("/risk-analyses/risk-1/decisions")) {
          return [
            {
              acknowledgedLimitations: true,
              createdAt: "2026-08-22T10:45:00.000Z",
              decision: "CONTINUE",
              id: "decision-1",
              rationale:
                "The tender still fits our delivery scope and risk appetite.",
              riskAnalysisRunId: "risk-1",
              supersededAt: null,
              tenderVersionId: "version-1",
            },
          ];
        }
        if (
          path.endsWith("/versions/version-1/eligibility-assessments/current")
        ) {
          currentAssessmentPolls += 1;
          return currentAssessmentPolls >= 2
            ? {
                id: "assessment-1",
                invalidatedAt: null,
                progressPercentage: 100,
                publicMessage: "Comparison complete",
                snapshot: { capturedAt: "2026-08-22T11:00:00.000Z" },
                status: "COMPLETE",
              }
            : null;
        }
        if (path.endsWith("/versions/version-1/eligibility-assessments")) {
          return currentAssessmentPolls >= 2
            ? [
                {
                  id: "assessment-1",
                  invalidatedAt: null,
                  progressPercentage: 100,
                  publicMessage: "Comparison complete",
                  snapshot: { capturedAt: "2026-08-22T11:00:00.000Z" },
                  status: "COMPLETE",
                },
              ]
            : [];
        }
        if (path.endsWith("/eligibility-assessments/assessment-1/matrix")) {
          return {
            counts: [{ _count: 1, currentState: "HUMAN_REVIEW_REQUIRED" }],
            items: [
              {
                currentState: "HUMAN_REVIEW_REQUIRED",
                evidenceLinks: [],
                id: "requirement-1",
                proposedConfidence: "MEDIUM",
                proposedRationale:
                  "A reviewer must confirm the interpretation.",
                proposedState: "HUMAN_REVIEW_REQUIRED",
                requirementCategory: "DELIVERY",
                requirementObligation: "MANDATORY",
                reviewState: "UNREVIEWED",
                structuredRequirement: {
                  normalizedStatement: "Complete the work within 90 days.",
                  title: "Delivery timeline",
                },
                tenderCitation: {
                  boundedExcerpt: "Complete the work within 90 days.",
                  documentName: "Synthetic_GeM_Tender_Test.pdf",
                  pageNumber: 1,
                  tenderDocumentId: "ready-document",
                },
                uncertainty: "Needs a reviewer decision.",
              },
            ],
            total: 1,
          };
        }
        if (path.endsWith("/versions/version-1/checklists/current")) {
          return null;
        }
        if (
          path.endsWith("/versions/version-1/checklists") ||
          path.endsWith("/draft-generation-runs") ||
          path.endsWith("/drafts")
        ) {
          return [];
        }
        return [];
      });

      render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

      expect(
        await screen.findByRole("heading", { name: "What matters now" }),
      ).toBeInTheDocument();
      expect(
        (await screen.findAllByText("Eligibility is starting")).length,
      ).toBeGreaterThan(0);

      await waitFor(() =>
        expect(intervalSpy.mock.calls.length).toBeGreaterThanOrEqual(2),
      );
      const refreshCallbacks = intervalSpy.mock.calls
        .map((call) => call[0])
        .filter(
          (callback): callback is () => void => typeof callback === "function",
        );
      expect(refreshCallbacks.length).toBeGreaterThanOrEqual(2);
      await act(async () => {
        await Promise.all(
          refreshCallbacks.map((callback) => Promise.resolve(callback())),
        );
      });

      await waitFor(() =>
        expect(currentAssessmentPolls).toBeGreaterThanOrEqual(2),
      );
      expect(
        screen.getAllByRole("button", { name: "Review requirements" }).length,
      ).toBeGreaterThan(0);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it("unblocks the draft surface automatically once the current eligibility result becomes available", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    try {
      let currentAssessmentPolls = 0;
      search = new URLSearchParams("stage=draft");
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
              code: "ASSESSMENT_NOT_STARTED",
              detail:
                "Eligibility will start automatically for the latest Continue decision.",
              isCompleted: false,
              isDraft: false,
              isInProgress: false,
              needsAttention: false,
              onHold: false,
              statusLabel: "Eligibility is starting",
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
              source_fingerprint: "fingerprint-a",
              status: "COMPLETE",
            },
          ];
        }
        if (
          path.endsWith("/extractions/extract-1/requirements") ||
          path.endsWith("/extractions/extract-1/fields") ||
          path.endsWith("/extractions/extract-1/issues")
        ) {
          return [];
        }
        if (path.endsWith("/versions/version-1/risk-analyses/current")) {
          return {
            created_at: "2026-08-22T10:30:00.000Z",
            id: "risk-1",
            is_current: true,
            safeFailureMessage: null,
            status: "COMPLETE",
          };
        }
        if (path.endsWith("/versions/version-1/risk-analyses")) {
          return [
            {
              created_at: "2026-08-22T10:30:00.000Z",
              id: "risk-1",
              is_current: true,
              safeFailureMessage: null,
              status: "COMPLETE",
            },
          ];
        }
        if (path.endsWith("/risk-analyses/risk-1/decisions")) {
          return [
            {
              acknowledgedLimitations: true,
              createdAt: "2026-08-22T10:45:00.000Z",
              decision: "CONTINUE",
              id: "decision-1",
              rationale:
                "The tender still fits our delivery scope and risk appetite.",
              riskAnalysisRunId: "risk-1",
              supersededAt: null,
              tenderVersionId: "version-1",
            },
          ];
        }
        if (
          path.endsWith("/versions/version-1/eligibility-assessments/current")
        ) {
          currentAssessmentPolls += 1;
          return currentAssessmentPolls >= 2
            ? {
                id: "assessment-1",
                invalidatedAt: null,
                progressPercentage: 100,
                publicMessage: "Comparison complete",
                snapshot: { capturedAt: "2026-08-22T11:00:00.000Z" },
                status: "COMPLETE",
              }
            : null;
        }
        if (path.endsWith("/versions/version-1/eligibility-assessments")) {
          return currentAssessmentPolls >= 2
            ? [
                {
                  id: "assessment-1",
                  invalidatedAt: null,
                  progressPercentage: 100,
                  publicMessage: "Comparison complete",
                  snapshot: { capturedAt: "2026-08-22T11:00:00.000Z" },
                  status: "COMPLETE",
                },
              ]
            : [];
        }
        if (path.endsWith("/eligibility-assessments/assessment-1/matrix")) {
          return {
            counts: [],
            items: [],
            total: 0,
          };
        }
        if (path.endsWith("/versions/version-1/checklists/current")) {
          return null;
        }
        if (
          path.endsWith("/versions/version-1/checklists") ||
          path.endsWith("/draft-generation-runs") ||
          path.endsWith("/drafts")
        ) {
          return [];
        }
        return [];
      });

      render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

      await waitFor(() =>
        expect(intervalSpy.mock.calls.length).toBeGreaterThanOrEqual(2),
      );
      const refreshCallbacks = intervalSpy.mock.calls
        .map((call) => call[0])
        .filter(
          (callback): callback is () => void => typeof callback === "function",
        );
      expect(refreshCallbacks.length).toBeGreaterThanOrEqual(2);
      await act(async () => {
        await Promise.all(
          refreshCallbacks.map((callback) => Promise.resolve(callback())),
        );
      });

      await waitFor(() =>
        expect(currentAssessmentPolls).toBeGreaterThanOrEqual(1),
      );
      await act(async () => {
        await Promise.all(
          intervalSpy.mock.calls
            .map((call) => call[0])
            .filter(
              (callback): callback is () => void =>
                typeof callback === "function",
            )
            .map((callback) => Promise.resolve(callback())),
        );
      });

      expect(
        await screen.findByText("Draft module mounted"),
      ).toBeInTheDocument();
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it("keeps historical eligibility and checklist data in audit mode when no current eligibility exists", async () => {
    search = new URLSearchParams("stage=eligibility");
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
            code: "ASSESSMENT_NOT_STARTED",
            detail:
              "Eligibility will start automatically for the latest Continue decision.",
            isCompleted: false,
            isDraft: false,
            isInProgress: false,
            needsAttention: false,
            onHold: false,
            statusLabel: "Eligibility is starting",
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
            source_fingerprint: "fingerprint-a",
            status: "COMPLETE",
          },
        ];
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
      if (path.endsWith("/versions/version-1/risk-analyses/current")) {
        return {
          created_at: "2026-08-22T10:30:00.000Z",
          id: "risk-1",
          is_current: true,
          safeFailureMessage: null,
          status: "COMPLETE",
        };
      }
      if (path.endsWith("/versions/version-1/risk-analyses")) {
        return [
          {
            created_at: "2026-08-22T10:30:00.000Z",
            id: "risk-1",
            is_current: true,
            safeFailureMessage: null,
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/risk-analyses/risk-1/decisions")) {
        return [
          {
            acknowledgedLimitations: true,
            createdAt: "2026-08-22T10:45:00.000Z",
            decision: "CONTINUE",
            id: "decision-1",
            rationale:
              "The tender still fits our delivery scope and risk appetite.",
            riskAnalysisRunId: "risk-1",
            supersededAt: null,
            tenderVersionId: "version-1",
          },
        ];
      }
      if (
        path.endsWith("/versions/version-1/eligibility-assessments/current")
      ) {
        return null;
      }
      if (path.endsWith("/versions/version-1/eligibility-assessments")) {
        return [
          {
            id: "assessment-old",
            invalidatedAt: "2026-08-22T12:00:00.000Z",
            progressPercentage: 100,
            publicMessage: "Historical assessment complete",
            snapshot: { capturedAt: "2026-08-22T11:00:00.000Z" },
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/versions/version-1/checklists/current")) {
        return null;
      }
      if (path.endsWith("/versions/version-1/checklists")) {
        return [
          {
            assessmentRunId: "assessment-old",
            checklistPolicyVersion: "policy-v1",
            completedAt: "2026-08-22T12:30:00.000Z",
            evidenceSnapshotId: "snapshot-1",
            id: "checklist-old",
            invalidatedAt: "2026-08-22T13:00:00.000Z",
            progressPercentage: 100,
            publicMessage: "Historical checklist complete",
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/draft-generation-runs") || path.endsWith("/drafts")) {
        return [];
      }
      return [];
    });

    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("heading", { name: /Requirements/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Eligibility is starting")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Missing items and actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Historical assessment complete"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Audit & evidence")).toBeInTheDocument();
    expect(captureActionChecklistProps).toHaveBeenCalledWith(
      expect.objectContaining({
        currentAssessmentRunId: null,
        presentation: "history",
      }),
    );
  });

  it("does not lead the review surface with empty blocker metrics when no current final review exists", async () => {
    search = new URLSearchParams("stage=review");
    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("heading", { name: "Final Review" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Readiness module mounted")).toBeInTheDocument();
    expect(screen.getByText("Export module mounted")).toBeInTheDocument();
    expect(screen.queryByText("Final review blockers")).not.toBeInTheDocument();
    expect(screen.queryByText("Final review warnings")).not.toBeInTheDocument();
  });

  it("keeps an existing pursuit decision collapsed until the user chooses to change it", async () => {
    const user = userEvent.setup();
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
        return [
          {
            created_at: "2026-08-22T10:30:00.000Z",
            id: "risk-1",
            is_current: true,
            safeFailureMessage: null,
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/risk-analyses/risk-1/decisions")) {
        return [
          {
            acknowledgedLimitations: true,
            createdAt: "2026-08-22T10:45:00.000Z",
            decision: "CONTINUE",
            id: "decision-1",
            rationale:
              "The tender still fits our delivery scope and risk appetite.",
            riskAnalysisRunId: "risk-1",
            supersededAt: null,
            tenderVersionId: "version-1",
          },
        ];
      }
      if (
        path.endsWith("/versions/version-1/eligibility-assessments") ||
        path.endsWith("/versions/version-1/checklists") ||
        path.endsWith("/draft-generation-runs") ||
        path.endsWith("/drafts")
      ) {
        return [];
      }
      if (
        path.endsWith("/extractions/extract-1/requirements") ||
        path.endsWith("/extractions/extract-1/fields") ||
        path.endsWith("/extractions/extract-1/issues")
      ) {
        return [];
      }
      return [];
    });

    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(await screen.findByText("Current decision:")).toBeInTheDocument();
    expect(screen.getByText(/Decision rationale:/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Decision/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change decision" }));
    expect(screen.getByLabelText(/Decision/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Rationale/)).toBeInTheDocument();
  });

  it("opens the evidence tools for direct requirement review actions", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("stage=eligibility");
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
            source_fingerprint: "fingerprint-a",
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/versions/version-1/risk-analyses")) {
        return [
          {
            created_at: "2026-08-22T10:30:00.000Z",
            id: "risk-1",
            is_current: true,
            safeFailureMessage: null,
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/risk-analyses/risk-1/decisions")) {
        return [
          {
            acknowledgedLimitations: true,
            createdAt: "2026-08-22T10:45:00.000Z",
            decision: "CONTINUE",
            id: "decision-1",
            rationale:
              "The tender still fits our delivery scope and risk appetite.",
            riskAnalysisRunId: "risk-1",
            supersededAt: null,
            tenderVersionId: "version-1",
          },
        ];
      }
      if (path.endsWith("/versions/version-1/eligibility-assessments")) {
        return [
          {
            id: "assessment-1",
            invalidatedAt: null,
            progressPercentage: 100,
            publicMessage: "Comparison complete",
            snapshot: { capturedAt: "2026-08-22T11:00:00.000Z" },
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/eligibility-assessments/assessment-1/matrix")) {
        return {
          counts: [{ _count: 1, currentState: "HUMAN_REVIEW_REQUIRED" }],
          items: [
            {
              currentState: "HUMAN_REVIEW_REQUIRED",
              evidenceLinks: [],
              id: "requirement-1",
              proposedConfidence: "MEDIUM",
              proposedRationale: "A reviewer must confirm the interpretation.",
              proposedState: "HUMAN_REVIEW_REQUIRED",
              requirementCategory: "DELIVERY",
              requirementObligation: "MANDATORY",
              reviewState: "UNREVIEWED",
              structuredRequirement: {
                normalizedStatement: "Complete the work within 90 days.",
                title: "Delivery timeline",
              },
              tenderCitation: {
                boundedExcerpt: "Complete the work within 90 days.",
                documentName: "Synthetic_GeM_Tender_Test.pdf",
                pageNumber: 1,
                tenderDocumentId: "ready-document",
              },
              uncertainty: "Needs a reviewer decision.",
            },
          ],
          total: 1,
        };
      }
      if (
        path.endsWith("/versions/version-1/checklists") ||
        path.endsWith("/draft-generation-runs") ||
        path.endsWith("/drafts") ||
        path.endsWith("/extractions/extract-1/requirements") ||
        path.endsWith("/extractions/extract-1/fields") ||
        path.endsWith("/extractions/extract-1/issues")
      ) {
        return [];
      }
      return [];
    });

    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    await user.click(
      await screen.findByRole("button", { name: "Review requirement" }),
    );

    expect(
      screen.getByText("Audit & evidence").closest("details"),
    ).toHaveAttribute("open");
    await waitFor(() =>
      expect(captureEvidenceMatrixProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          currentAssessmentRunId: "assessment-1",
        }),
      ),
    );
    const lastCall = captureEvidenceMatrixProps.mock.lastCall?.[0] as
      | {
          readonly focusRequest?: {
            readonly assessmentId?: string;
            readonly mode?: string;
          } | null;
        }
      | undefined;
    expect(lastCall?.focusRequest).toEqual(
      expect.objectContaining({
        assessmentId: "requirement-1",
        mode: "assessment",
      }),
    );
  });

  it("keeps requirement-linked actions in the selected requirement and reserves other actions for unmatched checklist work", async () => {
    search = new URLSearchParams("stage=eligibility");
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
            source_fingerprint: "fingerprint-a",
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/versions/version-1/risk-analyses")) {
        return [
          {
            created_at: "2026-08-22T10:30:00.000Z",
            id: "risk-1",
            is_current: true,
            safeFailureMessage: null,
            status: "COMPLETE",
          },
        ];
      }
      if (path.endsWith("/risk-analyses/risk-1/decisions")) {
        return [
          {
            acknowledgedLimitations: true,
            createdAt: "2026-08-22T10:45:00.000Z",
            decision: "CONTINUE",
            id: "decision-1",
            rationale:
              "The tender still fits our delivery scope and risk appetite.",
            riskAnalysisRunId: "risk-1",
            supersededAt: null,
            tenderVersionId: "version-1",
          },
        ];
      }
      if (
        path.endsWith("/versions/version-1/eligibility-assessments") ||
        path.endsWith("/versions/version-1/eligibility-assessments/current")
      ) {
        return [
          {
            id: "assessment-1",
            invalidatedAt: null,
            progressPercentage: 100,
            publicMessage: "Comparison complete",
            snapshot: { capturedAt: "2026-08-22T11:00:00.000Z" },
            status: "COMPLETE",
          },
        ][path.endsWith("/current") ? 0 : 0];
      }
      if (path.endsWith("/eligibility-assessments/assessment-1/matrix")) {
        return {
          counts: [{ _count: 1, currentState: "HUMAN_REVIEW_REQUIRED" }],
          items: [
            {
              currentState: "HUMAN_REVIEW_REQUIRED",
              evidenceLinks: [],
              id: "assessment-item-1",
              proposedConfidence: "MEDIUM",
              proposedRationale: "A reviewer must confirm the interpretation.",
              proposedState: "HUMAN_REVIEW_REQUIRED",
              requirementCategory: "OTHER",
              requirementObligation: "MANDATORY",
              reviewState: "UNREVIEWED",
              structuredRequirement: {
                id: "requirement-1",
                normalizedStatement:
                  "Small businesses must discover the right tenders.",
                title: "OTHER requirement",
              },
              tenderCitation: {
                boundedExcerpt:
                  "Small businesses must discover the right tenders.",
                documentName: "Synthetic_GeM_Tender_Test.pdf",
                pageNumber: 1,
                tenderDocumentId: "ready-document",
              },
              uncertainty: "Needs a reviewer decision.",
            },
          ],
          total: 1,
        };
      }
      if (
        path.endsWith("/versions/version-1/checklists") ||
        path.endsWith("/versions/version-1/checklists/current")
      ) {
        return path.endsWith("/current")
          ? {
              assessmentRunId: "assessment-1",
              checklistPolicyVersion: "policy-v1",
              completedAt: "2026-08-22T12:30:00.000Z",
              evidenceSnapshotId: "snapshot-1",
              id: "checklist-current",
              invalidatedAt: null,
              progressPercentage: 100,
              publicMessage: "Current checklist complete",
              status: "COMPLETE",
            }
          : [
              {
                assessmentRunId: "assessment-1",
                checklistPolicyVersion: "policy-v1",
                completedAt: "2026-08-22T12:30:00.000Z",
                evidenceSnapshotId: "snapshot-1",
                id: "checklist-current",
                invalidatedAt: null,
                progressPercentage: 100,
                publicMessage: "Current checklist complete",
                status: "COMPLETE",
              },
            ];
      }
      if (path.endsWith("/checklists/checklist-current/items")) {
        return {
          items: [
            {
              assessmentLinks: [{ assessmentId: "assessment-item-1" }],
              completionCriteria:
                "An authorised reviewer records the cited interpretation.",
              currentDueDate: null,
              currentPriority: "HIGH",
              currentTitle: "Review ambiguous requirement",
              dateIsOfficial: false,
              evidenceNeedCategory: "LEGAL_INTERPRETATION",
              id: "item-linked",
              itemType: "REVIEW_ACTION",
              proposedExplanation:
                "This action is derived from the latest eligibility review.",
              requirementLinks: [{ structuredRequirementId: "requirement-1" }],
              status: "OPEN",
            },
            {
              assessmentLinks: [],
              completionCriteria:
                "Confirm the shared cover letter is uploaded once.",
              currentDueDate: null,
              currentPriority: "MEDIUM",
              currentTitle: "Confirm shared submission cover letter",
              dateIsOfficial: false,
              evidenceNeedCategory: "DOCUMENT_COLLECTION",
              id: "item-other",
              itemType: "REVIEW_ACTION",
              proposedExplanation:
                "This action is not tied to one extracted requirement.",
              requirementLinks: [],
              status: "OPEN",
            },
          ],
          priority_counts: [],
          status_counts: [],
          total: 2,
        };
      }
      if (
        path.endsWith("/draft-generation-runs") ||
        path.endsWith("/drafts") ||
        path.endsWith("/extractions/extract-1/requirements") ||
        path.endsWith("/extractions/extract-1/fields") ||
        path.endsWith("/extractions/extract-1/issues")
      ) {
        return [];
      }
      return [];
    });

    render(<TenderWorkspace organisationId="org-1" tenderId="tender-1" />);

    expect(
      await screen.findByRole("heading", { name: /Requirements/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Small businesses must discover the right tenders.",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Other requirement").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Review requirement" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Human interpretation is required before the system can determine whether this requirement is satisfied.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This action is derived from the latest eligibility review.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("0 Other actions")).not.toBeInTheDocument();
    expect(screen.getByText("Checklist module mounted")).toBeInTheDocument();
    const auditDetails = screen
      .getByText("Audit & evidence")
      .closest("details");
    expect(auditDetails).not.toBeNull();
    expect(auditDetails).not.toHaveAttribute("open");
    expect(screen.queryByText(/Phase 7/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/policy-v1/i)).not.toBeInTheDocument();
    const detailCard = screen
      .getByRole("heading", {
        name: "Small businesses must discover the right tenders.",
      })
      .closest(".workspace-card");
    expect(detailCard).not.toBeNull();
    if (!(detailCard instanceof HTMLElement)) {
      throw new Error("Expected requirement detail card container.");
    }
    expect(
      within(detailCard).queryByRole("heading", {
        name: "Requirement",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(detailCard).getByRole("heading", {
        name: "Status",
      }),
    ).toBeInTheDocument();
    expect(
      within(detailCard).getAllByText("Human review required"),
    ).toHaveLength(1);
    const missingItemsSection = screen
      .getByRole("heading", {
        name: "Missing items",
      })
      .closest(".workspace-section");
    expect(missingItemsSection).not.toBeNull();
    if (!(missingItemsSection instanceof HTMLElement)) {
      throw new Error("Expected missing items section.");
    }
    expect(missingItemsSection).toHaveTextContent(
      /2\s*actions\s+need\s+attention/i,
    );
    expect(
      within(detailCard).getByRole("heading", {
        name: "Primary action",
      }),
    ).toBeInTheDocument();
    const companyEvidenceHeading = within(detailCard).getByRole("heading", {
      name: "Company evidence",
    });
    const companyEvidenceSection = companyEvidenceHeading.closest("section");
    expect(companyEvidenceSection).not.toBeNull();
    if (!(companyEvidenceSection instanceof HTMLElement)) {
      throw new Error("Expected company evidence section.");
    }
    expect(
      within(companyEvidenceSection).queryByRole("button", {
        name: "Upload tender file",
      }),
    ).not.toBeInTheDocument();

    const fullChecklistCall = captureActionChecklistProps.mock.calls
      .map(
        ([props]) =>
          props as {
            presentation?: "full" | "history";
            visibleItemIds?: string[];
          },
      )
      .find((props) => props.presentation !== "history");
    expect(fullChecklistCall).toEqual(
      expect.objectContaining({
        visibleItemIds: ["item-other"],
      }),
    );
  });
});
