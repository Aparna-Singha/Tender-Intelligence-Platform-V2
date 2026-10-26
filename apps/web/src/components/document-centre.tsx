"use client";

import { ContextualAssistant } from "./contextual-assistant";

import { Download, FileCheck2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Table,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, formatApiError, PublicApiError } from "../lib/api";
import { assistantHref } from "../lib/assistant";
import { uploadFileToSignedStorageUrl } from "../lib/direct-upload";

interface DocumentSummary {
  readonly category: string;
  readonly displayName: string;
  readonly expiryDate: string | null;
  readonly id: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly verificationStatus: string;
}

interface UploadSession {
  readonly document_id: string;
  readonly upload_session_id: string;
  readonly upload_url: string;
}

interface DocumentDetails extends DocumentSummary {
  readonly versions: readonly {
    readonly createdAt: string;
    readonly detectedMimeType: string | null;
    readonly id: string;
    readonly originalFilename: string;
    readonly sizeBytes: string;
    readonly versionNumber: number;
  }[];
}

const categories = [
  "UDYAM",
  "GST",
  "PAN",
  "CIN",
  "AUDITED_FINANCIAL_STATEMENT",
  "TURNOVER_CERTIFICATE",
  "PURCHASE_ORDER",
  "COMPLETION_CERTIFICATE",
  "EXPERIENCE_CERTIFICATE",
  "OEM_AUTHORISATION",
  "ISO_CERTIFICATE",
  "LICENCE",
  "PRODUCT_DATASHEET",
  "DECLARATION",
  "BANK_DOCUMENT",
  "OTHER",
] as const;

const COMPANY_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const companyDocumentMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const transitionalDocumentStatuses = new Set([
  "UPLOADED",
  "SCANNING",
  "PROCESSING",
]);
const settledDocumentStatuses = new Set([
  "READY",
  "REJECTED",
  "FAILED",
  "QUARANTINED",
  "EXPIRED",
]);

class CompanyDocumentUploadError extends Error {
  public constructor(
    public readonly stage:
      | "file-size"
      | "file-type"
      | "processing"
      | "session"
      | "storage"
      | "verification",
    public readonly source?: unknown,
  ) {
    super(stage);
    this.name = "CompanyDocumentUploadError";
  }
}

function isExpired(date: string | null): boolean {
  return date !== null && new Date(date).getTime() < Date.now();
}

function isExpiringSoon(date: string | null): boolean {
  if (date === null) return false;
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
  return days >= 0 && days <= 30;
}

function verificationTone(
  status: string,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "VERIFIED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "HUMAN_REVIEW_REQUIRED") return "warning";
  return "neutral";
}

function expiryLabel(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const categoryGroups: Readonly<Record<string, string>> = {
  AUDITED_FINANCIAL_STATEMENT: "Financial",
  BANK_DOCUMENT: "Financial",
  CIN: "Legal & Registration",
  COMPLETION_CERTIFICATE: "Past Experience",
  DECLARATION: "Legal & Registration",
  EXPERIENCE_CERTIFICATE: "Past Experience",
  GST: "Legal & Registration",
  ISO_CERTIFICATE: "Certificates",
  LICENCE: "Certificates",
  OEM_AUTHORISATION: "Certificates",
  PAN: "Legal & Registration",
  PRODUCT_DATASHEET: "Certificates",
  PURCHASE_ORDER: "Past Experience",
  TURNOVER_CERTIFICATE: "Financial",
  UDYAM: "Legal & Registration",
};

function categoryGroup(category: string): string {
  return categoryGroups[category] ?? "Other";
}

function documentHealth(document: DocumentSummary): {
  readonly current: boolean;
  readonly expiringSoon: boolean;
  readonly needsAttention: boolean;
  readonly outdated: boolean;
} {
  const outdated =
    document.status === "EXPIRED" || isExpired(document.expiryDate);
  const expiringSoon = !outdated && isExpiringSoon(document.expiryDate);
  const needsAttention =
    ["FAILED", "REJECTED", "QUARANTINED"].includes(document.status) ||
    ["HUMAN_REVIEW_REQUIRED", "REJECTED", "UNVERIFIED"].includes(
      document.verificationStatus,
    );
  const current =
    document.status === "READY" &&
    document.verificationStatus === "VERIFIED" &&
    !outdated;
  return { current, expiringSoon, needsAttention, outdated };
}

function documentDisplayStatus(document: DocumentSummary): {
  readonly label: string;
  readonly tone: "neutral" | "info" | "success" | "warning" | "danger";
} {
  if (document.status === "REJECTED")
    return { label: "Rejected", tone: "danger" };
  if (document.status === "FAILED") return { label: "Failed", tone: "danger" };
  if (document.status === "QUARANTINED")
    return { label: "Quarantined", tone: "warning" };
  const health = documentHealth(document);
  if (health.outdated) return { label: "Outdated", tone: "danger" };
  if (health.expiringSoon) return { label: "Expiring soon", tone: "warning" };
  if (health.needsAttention) return { label: "Needs review", tone: "warning" };
  if (health.current) return { label: "Verified", tone: "success" };
  if (transitionalDocumentStatuses.has(document.status))
    return { label: "Processing", tone: "info" };
  return {
    label: humanizeEnum(document.verificationStatus || document.status),
    tone: verificationTone(document.verificationStatus),
  };
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function uploadErrorMessage(error: unknown): string {
  if (!(error instanceof CompanyDocumentUploadError)) {
    return formatApiError(
      error,
      "The upload could not be completed. Please try again.",
    );
  }

  if (error.stage === "file-type") {
    return "This file type is not supported.";
  }
  if (error.stage === "file-size") {
    return "This file is too large. Upload a file up to 25 MB.";
  }
  if (error.stage === "storage") {
    return "Upload to secure storage failed. Please try again.";
  }
  if (error.stage === "verification") {
    return "The file reached secure storage but could not be verified.";
  }
  if (error.stage === "processing") {
    return "Security checks or processing rejected this upload.";
  }
  if (error.source instanceof PublicApiError) {
    if (
      error.source.status === 409 &&
      error.source.code === "DOCUMENT_DUPLICATE"
    ) {
      return "This exact document has already been uploaded.";
    }
    if (error.source.message === "File type is not allowed") {
      return "This file type is not supported.";
    }
  }
  return "Could not start a secure upload. Please try again.";
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function DocumentCentre({
  organisationId,
}: {
  readonly organisationId: string;
}): JSX.Element {
  const searchParams = useSearchParams();
  const returnToCandidate = searchParams.get("returnTo");
  const returnTo = returnToCandidate?.startsWith(`/tenders/${organisationId}/`)
    ? returnToCandidate
    : null;
  const [documents, setDocuments] = useState<readonly DocumentSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [message, setMessage] = useState("Loading documents...");
  const [selected, setSelected] = useState<DocumentDetails | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function fetchDocuments(): Promise<readonly DocumentSummary[]> {
    return apiRequest<readonly DocumentSummary[]>(
      `/organisations/${organisationId}/documents`,
    );
  }

  async function load(): Promise<void> {
    try {
      const loaded = await fetchDocuments();
      setDocuments(loaded);
      setMessage("");
    } catch (caught) {
      setMessage(formatApiError(caught, "Unable to load company documents."));
    }
  }

  useEffect(() => {
    void load();
  }, [organisationId]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      const group = categoryGroup(document.category);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return counts;
  }, [documents]);

  const availableCategories = useMemo(
    () =>
      [
        ...new Set(
          documents.map((document) => categoryGroup(document.category)),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [documents],
  );

  const healthSummary = useMemo(() => {
    let current = 0;
    let expiringSoon = 0;
    let needsAttention = 0;
    let outdated = 0;
    for (const document of documents) {
      const state = documentHealth(document);
      if (state.current) current += 1;
      if (state.expiringSoon) expiringSoon += 1;
      if (state.needsAttention) needsAttention += 1;
      if (state.outdated) outdated += 1;
    }
    return { current, expiringSoon, needsAttention, outdated };
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    return documents.filter((document) => {
      if (
        selectedCategory !== "" &&
        categoryGroup(document.category) !== selectedCategory
      )
        return false;
      if (trimmedQuery === "") return true;
      return (
        document.displayName.toLowerCase().includes(trimmedQuery) ||
        humanizeEnum(document.category).toLowerCase().includes(trimmedQuery) ||
        humanizeEnum(document.status).toLowerCase().includes(trimmedQuery)
      );
    });
  }, [documents, query, selectedCategory]);

  async function refreshUploadedDocument(documentId: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const loaded = await fetchDocuments();
        setDocuments(loaded);
        const document = loaded.find((item) => item.id === documentId);
        if (document === undefined) return;
        if (document.status === "READY") {
          setMessage("Document ready. Reusable evidence is up to date.");
          return;
        }
        if (settledDocumentStatuses.has(document.status)) {
          throw new CompanyDocumentUploadError("processing");
        }
        if (!transitionalDocumentStatuses.has(document.status)) return;
      } catch (caught) {
        setMessage(uploadErrorMessage(caught));
        return;
      }
      await delay(1_000);
    }
    setMessage(
      "Upload accepted. Security checks are still running and this list will update automatically.",
    );
  }

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (uploading) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const fileField = form.elements.namedItem("file");
    const selectedFile =
      fileField instanceof HTMLInputElement
        ? ((fileField.files ?? [])[0] ?? null)
        : null;
    const fileEntry = values.get("file");
    const file =
      fileEntry instanceof File && fileEntry.size > 0
        ? fileEntry
        : selectedFile;
    if (!(file instanceof File) || file.size === 0) return;
    const expiryDate = values.get("expiry_date");
    setUploading(true);
    setUploadError("");
    setMessage("Calculating file checksum...");
    try {
      if (!companyDocumentMimeTypes.has(file.type)) {
        throw new CompanyDocumentUploadError("file-type");
      }
      if (file.size > COMPANY_DOCUMENT_MAX_BYTES) {
        throw new CompanyDocumentUploadError("file-size");
      }
      const checksum = await sha256(file);
      setMessage("Requesting a private upload session...");
      let session: UploadSession;
      try {
        session = await apiRequest<UploadSession>(
          `/organisations/${organisationId}/documents/upload-sessions`,
          {
            body: JSON.stringify({
              category: values.get("category"),
              checksum_sha256: checksum,
              expiry_date:
                typeof expiryDate === "string" && expiryDate.length > 0
                  ? expiryDate
                  : undefined,
              filename: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            }),
            method: "POST",
          },
        );
      } catch (caught) {
        throw new CompanyDocumentUploadError("session", caught);
      }
      setMessage("Uploading directly to private storage...");
      try {
        await uploadFileToSignedStorageUrl(session.upload_url, file, checksum);
      } catch (caught) {
        try {
          await apiRequest(
            `/organisations/${organisationId}/documents/upload-sessions/${session.upload_session_id}`,
            { method: "DELETE" },
          );
        } catch {
          // Preserve the upload failure as the authoritative user-visible error.
        }
        throw new CompanyDocumentUploadError("storage", caught);
      }
      setMessage("Verifying upload and starting security checks...");
      try {
        await apiRequest(
          `/organisations/${organisationId}/documents/upload-sessions/${session.upload_session_id}/complete`,
          {
            body: JSON.stringify({ checksum_sha256: checksum }),
            method: "POST",
          },
        );
      } catch (caught) {
        throw new CompanyDocumentUploadError("verification", caught);
      }
      form.reset();
      setUploadOpen(false);
      setMessage(
        "Upload accepted. Malware, type and integrity checks are in progress.",
      );
      setUploading(false);
      void refreshUploadedDocument(session.document_id);
    } catch (caught) {
      setUploadError(uploadErrorMessage(caught));
      setUploading(false);
    }
  }

  async function showDetails(documentId: string): Promise<void> {
    try {
      setSelected(
        await apiRequest<DocumentDetails>(
          `/organisations/${organisationId}/documents/${documentId}`,
        ),
      );
    } catch (caught) {
      setMessage(formatApiError(caught, "Unable to load document details."));
    }
  }

  async function download(documentId: string): Promise<void> {
    try {
      const result = await apiRequest<{ download_url: string }>(
        `/organisations/${organisationId}/documents/${documentId}/download`,
        { method: "POST" },
      );
      window.location.assign(result.download_url);
    } catch (caught) {
      setMessage(
        formatApiError(caught, "The authorised download could not be created."),
      );
    }
  }

  return (
    <div className="workspace-page company-docs-page">
      <PageHeader
        actions={
          <>
            {returnTo === null ? null : (
              <Link className="button button--secondary" href={returnTo}>
                Return to tender
              </Link>
            )}
            <Button onClick={() => setUploadOpen(true)}>
              <Plus aria-hidden="true" size={18} />
              Upload document
            </Button>
          </>
        }
        description="Reusable company evidence used across tender eligibility checks."
        title="Company documents"
      />

      <div className="company-docs-health" aria-label="Evidence health">
        <div className="company-docs-health__item">
          <span className="tender-summary-card__label">Current</span>
          <strong>{healthSummary.current}</strong>
          <p>
            Ready documents with verified review state and without expired
            validity.
          </p>
        </div>
        <div className="company-docs-health__item">
          <span className="tender-summary-card__label">Need attention</span>
          <strong>{healthSummary.needsAttention}</strong>
          <p>
            Processing failures, quarantine, or verification states that still
            need review.
          </p>
        </div>
        <div className="company-docs-health__item">
          <span className="tender-summary-card__label">Expiring soon</span>
          <strong>{healthSummary.expiringSoon}</strong>
          <p>Documents with known expiry dates inside the next 30 days.</p>
        </div>
        <div className="company-docs-health__item">
          <span className="tender-summary-card__label">Outdated</span>
          <strong>{healthSummary.outdated}</strong>
          <p>
            Expired documents or records already marked with expired processing
            state.
          </p>
        </div>
        <div className="company-docs-health__item company-docs-health__item--summary">
          <span className="tender-summary-card__label">Evidence health</span>
          <p>
            {healthSummary.needsAttention + healthSummary.expiringSoon} document
            {healthSummary.needsAttention + healthSummary.expiringSoon === 1
              ? ""
              : "s"}{" "}
            may affect active tenders
          </p>
        </div>
      </div>

      <Card className="company-docs-toolbar">
        <div className="company-docs-toolbar__search">
          <Search aria-hidden="true" size={16} />
          <Input
            aria-label="Search company docs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documents"
            value={query}
          />
        </div>
        <Select
          aria-label="Filter company documents by category"
          onChange={(event) => setSelectedCategory(event.target.value)}
          value={selectedCategory}
        >
          <option value="">All categories</option>
          {availableCategories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </Select>
      </Card>

      <div className="company-docs-layout">
        <aside className="workspace-card company-docs-sidebar">
          <div className="company-docs-sidebar__header">
            <h2>Categories</h2>
          </div>
          <button
            className={`company-docs-sidebar__link ${selectedCategory === "" ? "company-docs-sidebar__link--active" : ""}`}
            onClick={() => setSelectedCategory("")}
            type="button"
          >
            <span>All documents</span>
            <Badge tone="neutral">{documents.length}</Badge>
          </button>
          {availableCategories.map((category) => (
            <button
              className={`company-docs-sidebar__link ${selectedCategory === category ? "company-docs-sidebar__link--active" : ""}`}
              key={category}
              onClick={() => setSelectedCategory(category)}
              type="button"
            >
              <span>{category}</span>
              <Badge tone="neutral">{categoryCounts.get(category) ?? 0}</Badge>
            </button>
          ))}
        </aside>

        <div className="workspace-section">
          {message !== "" ? <p aria-live="polite">{message}</p> : null}

          {filteredDocuments.length === 0 && message === "" ? (
            <Card className="workspace-card">
              <EmptyState
                action={
                  <Button onClick={() => setUploadOpen(true)}>
                    <FileCheck2 aria-hidden="true" size={18} />
                    Upload document
                  </Button>
                }
                description="No company documents match the current category, search, or status filters."
                title="Nothing matches these filters"
              />
            </Card>
          ) : (
            <Card className="company-docs-table-card">
              <Table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Valid until</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((document) => {
                    const displayStatus = documentDisplayStatus(document);
                    return (
                      <tr key={document.id}>
                        <td>
                          <button
                            className="company-docs-table__document"
                            onClick={() => void showDetails(document.id)}
                            type="button"
                          >
                            {document.displayName}
                          </button>
                        </td>
                        <td>{categoryGroup(document.category)}</td>
                        <td>
                          <Badge tone={displayStatus.tone}>
                            {displayStatus.label}
                          </Badge>
                        </td>
                        <td>{expiryLabel(document.expiryDate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      </div>

      {uploadOpen ? (
        <Modal
          label="Upload company document"
          onClose={() => {
            if (!uploading) setUploadOpen(false);
          }}
        >
          <div className="drawer-header">
            <div>
              <span className="eyebrow">Private evidence</span>
              <h2>Upload document</h2>
            </div>
            <IconButton
              disabled={uploading}
              label="Close"
              onClick={() => setUploadOpen(false)}
            >
              <X aria-hidden="true" size={18} />
            </IconButton>
          </div>
          <p>PDF, JPG/JPEG, PNG, DOCX, or XLSX up to 25 MB.</p>
          <form onSubmit={(event) => void upload(event)}>
            <Field label="Category" required>
              <Select name="category" required>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {humanizeEnum(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="File" required>
              <Input
                accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
                name="file"
                required
                type="file"
              />
            </Field>
            <Field label="Expiry date, if applicable">
              <Input name="expiry_date" type="date" />
            </Field>
            {uploadError !== "" ? (
              <FormMessage>{uploadError}</FormMessage>
            ) : null}
            <div className="inline-actions">
              <Button loading={uploading} type="submit">
                {uploading ? "Uploading securely..." : "Upload securely"}
              </Button>
              <Button
                disabled={uploading}
                onClick={() => setUploadOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {selected !== null ? (
        <Drawer
          label={`${selected.displayName} details`}
          onClose={() => setSelected(null)}
        >
          <div className="drawer-header">
            <div>
              <span className="eyebrow">Document details</span>
              <h2>{selected.displayName}</h2>
            </div>
            <IconButton label="Close details" onClick={() => setSelected(null)}>
              <X aria-hidden="true" size={18} />
            </IconButton>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Category</dt>
              <dd>{humanizeEnum(selected.category)}</dd>
            </div>
            <div>
              <dt>Processing</dt>
              <dd>{humanizeEnum(selected.status)}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>{humanizeEnum(selected.verificationStatus)}</dd>
            </div>
            <div>
              <dt>Expiry</dt>
              <dd>{expiryLabel(selected.expiryDate)}</dd>
            </div>
          </dl>
          <div className="section-header">
            <div>
              <h3>Version history</h3>
              <p>Immutable upload versions recorded for this document.</p>
            </div>
          </div>
          <ol className="version-list">
            {selected.versions.map((version) => (
              <li key={version.id}>
                <strong>Version {version.versionNumber}</strong>
                <span>{version.originalFilename}</span>
                <span>
                  {Number(version.sizeBytes).toLocaleString()} bytes,{" "}
                  {version.detectedMimeType ?? "Type pending"}
                </span>
                <span>Uploaded {formatTimestamp(version.createdAt)}</span>
              </li>
            ))}
          </ol>
          <Button
            disabled={selected.status !== "READY"}
            onClick={() => void download(selected.id)}
          >
            <Download aria-hidden="true" size={17} />
            Download authorised copy
          </Button>
        </Drawer>
      ) : null}

      <ContextualAssistant
        context="company documents"
        organisationId={organisationId}
        openInChatHref={assistantHref(organisationId)}
      />
    </div>
  );
}
