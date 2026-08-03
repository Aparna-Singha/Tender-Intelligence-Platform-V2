"use client";

import { Download, FileCheck2, Plus, ShieldCheck, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type JSX } from "react";
import {
  Badge,
  Button,
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
import { apiRequest, formatApiError } from "../lib/api";

interface DocumentSummary {
  category: string;
  displayName: string;
  expiryDate: string | null;
  id: string;
  status: string;
  verificationStatus: string;
  updatedAt: string;
}
interface UploadSession {
  document_id: string;
  upload_session_id: string;
  upload_url: string;
}
interface DocumentDetails extends DocumentSummary {
  versions: readonly {
    createdAt: string;
    detectedMimeType: string | null;
    id: string;
    originalFilename: string;
    sizeBytes: string;
    versionNumber: number;
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
const statuses = [
  "UPLOADING",
  "UPLOADED",
  "SCANNING",
  "QUARANTINED",
  "PROCESSING",
  "READY",
  "REJECTED",
  "FAILED",
  "EXPIRED",
] as const;
async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
function statusTone(
  status: string,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "READY") return "success";
  if (["REJECTED", "FAILED", "EXPIRED"].includes(status)) return "danger";
  if (["SCANNING", "QUARANTINED"].includes(status)) return "warning";
  return "info";
}
function expiryLabel(value: string | null): string {
  if (value === null) return "Not supplied";
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `Expired ${new Date(value).toLocaleDateString()}`;
  if (days <= 30)
    return `Expiring soon · ${new Date(value).toLocaleDateString()}`;
  return new Date(value).toLocaleDateString();
}

export function DocumentCentre({
  organisationId,
}: {
  readonly organisationId: string;
}): JSX.Element {
  const [documents, setDocuments] = useState<readonly DocumentSummary[]>([]);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("Loading documents…");
  const [selected, setSelected] = useState<DocumentDetails | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  async function load(): Promise<void> {
    const params = new URLSearchParams();
    if (category !== "") params.set("category", category);
    if (status !== "") params.set("status", status);
    try {
      setDocuments(
        await apiRequest(
          `/organisations/${organisationId}/documents${params.size === 0 ? "" : `?${params}`}`,
        ),
      );
      setMessage("");
    } catch (caught) {
      setMessage(formatApiError(caught, "Unable to load company documents."));
    }
  }
  useEffect(() => {
    void load();
  }, [category, status, organisationId]);
  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (uploading) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    const expiryDate = values.get("expiry_date");
    setUploading(true);
    setUploadError("");
    setMessage("Calculating file checksum…");
    try {
      const checksum = await sha256(file);
      setMessage("Requesting a private upload session…");
      const session = await apiRequest<UploadSession>(
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
      setMessage("Uploading directly to private storage…");
      const response = await fetch(session.upload_url, {
        body: file,
        headers: { "content-type": file.type, "x-amz-meta-sha256": checksum },
        method: "PUT",
      });
      if (!response.ok) throw new Error("The private object upload failed.");
      await apiRequest(
        `/organisations/${organisationId}/documents/upload-sessions/${session.upload_session_id}/complete`,
        { body: JSON.stringify({ checksum_sha256: checksum }), method: "POST" },
      );
      form.reset();
      setUploadOpen(false);
      setMessage(
        "Upload accepted. Malware, type and integrity checks are in progress.",
      );
      setUploading(false);
      await load();
    } catch (caught) {
      setUploadError(
        formatApiError(
          caught,
          "The upload could not be accepted. Check the file type and size, then try again.",
        ),
      );
      setUploading(false);
    }
  }
  async function showDetails(documentId: string): Promise<void> {
    try {
      setSelected(
        await apiRequest(
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
    <div className="page">
      <PageHeader
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Plus aria-hidden="true" size={18} />
            Upload company document
          </Button>
        }
        description="Store reusable company evidence privately. Uploaded and processed files are not automatically verified and do not prove tender eligibility."
        eyebrow="Company evidence"
        title="Document centre"
      />
      <div className="security-note">
        <ShieldCheck aria-hidden="true" size={20} />
        <p>
          Files upload directly to private storage using a short-lived signed
          URL. Access remains organisation-scoped and downloads require fresh
          authorisation.
        </p>
      </div>
      <div className="filter-bar">
        <Field label="Category">
          <Select
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {humanizeEnum(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Processing status">
          <Select
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">All statuses</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {humanizeEnum(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {message !== "" && <p aria-live="polite">{message}</p>}
      {documents.length === 0 && message === "" ? (
        <EmptyState
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <FileCheck2 aria-hidden="true" size={18} />
              Upload company document
            </Button>
          }
          description="Add a supported company document when evidence is available. Processing does not mean verification."
          title="No company documents match these filters"
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Category</th>
              <th>Processing</th>
              <th>Verification</th>
              <th>Expiry</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id}>
                <td>
                  <strong>{document.displayName}</strong>
                </td>
                <td>{humanizeEnum(document.category)}</td>
                <td>
                  <Badge tone={statusTone(document.status)}>
                    {humanizeEnum(document.status)}
                  </Badge>
                </td>
                <td>
                  <Badge
                    tone={
                      document.verificationStatus === "VERIFIED"
                        ? "success"
                        : document.verificationStatus === "REJECTED"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {humanizeEnum(document.verificationStatus)}
                  </Badge>
                </td>
                <td>{expiryLabel(document.expiryDate)}</td>
                <td>
                  <div className="inline-actions">
                    <Button
                      onClick={() => void showDetails(document.id)}
                      variant="quiet"
                    >
                      Details
                    </Button>
                    <IconButton
                      disabled={document.status !== "READY"}
                      label={`Download ${document.displayName}`}
                      onClick={() => void download(document.id)}
                    >
                      <Download aria-hidden="true" size={17} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {uploadOpen && (
        <Modal
          label="Upload company document"
          onClose={() => {
            if (!uploading) setUploadOpen(false);
          }}
        >
          <div className="drawer-header">
            <div>
              <span className="eyebrow">Private evidence</span>
              <h2>Upload company document</h2>
            </div>
            <IconButton
              disabled={uploading}
              label="Close"
              onClick={() => setUploadOpen(false)}
            >
              <X aria-hidden="true" size={18} />
            </IconButton>
          </div>
          <p>
            PDF, JPG, PNG, DOCX or XLSX up to the configured secure-upload
            limit.
          </p>
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
            {uploadError !== "" && <FormMessage>{uploadError}</FormMessage>}
            <div className="inline-actions">
              <Button loading={uploading} type="submit">
                {uploading ? "Uploading securely…" : "Upload securely"}
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
      )}
      {selected !== null && (
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
                  {Number(version.sizeBytes).toLocaleString()} bytes ·{" "}
                  {version.detectedMimeType ?? "Type pending"}
                </span>
                <span>
                  Uploaded {new Date(version.createdAt).toLocaleString()}
                </span>
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
      )}
    </div>
  );
}
