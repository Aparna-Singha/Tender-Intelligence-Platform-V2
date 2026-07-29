"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type JSX } from "react";
import { apiRequest } from "../lib/api";

interface DocumentSummary {
  category: string;
  displayName: string;
  expiryDate: string | null;
  id: string;
  status: string;
  verificationStatus: string;
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
];

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
  const [documents, setDocuments] = useState<readonly DocumentSummary[]>([]);
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("Loading documents…");
  const [selected, setSelected] = useState<DocumentDetails | null>(null);

  async function load(): Promise<void> {
    const query =
      category === "" ? "" : `?category=${encodeURIComponent(category)}`;
    try {
      setDocuments(
        await apiRequest(`/organisations/${organisationId}/documents${query}`),
      );
      setMessage("");
    } catch {
      setMessage("Unable to load documents.");
    }
  }

  useEffect(() => {
    void load();
  }, [category, organisationId]);

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    const expiryDate = values.get("expiry_date");
    setMessage("Preparing secure upload…");
    try {
      const checksum = await sha256(file);
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
      const response = await fetch(session.upload_url, {
        body: file,
        headers: {
          "content-type": file.type,
          "x-amz-meta-sha256": checksum,
        },
        method: "PUT",
      });
      if (!response.ok) throw new Error("Object upload failed");
      await apiRequest(
        `/organisations/${organisationId}/documents/upload-sessions/${session.upload_session_id}/complete`,
        { body: JSON.stringify({ checksum_sha256: checksum }), method: "POST" },
      );
      form.reset();
      setMessage("Upload accepted. Security processing is in progress.");
      await load();
    } catch {
      setMessage(
        "The upload could not be accepted. Check the file type and size.",
      );
    }
  }

  async function showDetails(documentId: string): Promise<void> {
    setSelected(
      await apiRequest(
        `/organisations/${organisationId}/documents/${documentId}`,
      ),
    );
  }

  async function download(documentId: string): Promise<void> {
    const result = await apiRequest<{ download_url: string }>(
      `/organisations/${organisationId}/documents/${documentId}/download`,
      { method: "POST" },
    );
    window.location.assign(result.download_url);
  }

  return (
    <main>
      <div className="panel">
        <Link href="/dashboard">Back to dashboard</Link>
        <h1>Document centre</h1>
        <p>
          Files remain private and cannot be downloaded until checksum, type,
          and malware checks finish.
        </p>
        <form onSubmit={(event) => void upload(event)}>
          <h2>Upload company document</h2>
          <label>
            Category
            <select name="category" required>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            File
            <input
              accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
              name="file"
              required
              type="file"
            />
          </label>
          <label>
            Expiry date, if applicable
            <input name="expiry_date" type="date" />
          </label>
          <button type="submit">Upload securely</button>
        </form>
        <label>
          Filter by category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <p aria-live="polite">{message}</p>
        <div aria-label="Company documents">
          {documents.map((document) => (
            <article key={document.id}>
              <h2>{document.displayName}</h2>
              <p>
                {document.category.replaceAll("_", " ")} · {document.status}
              </p>
              <p>Verification: {document.verificationStatus}</p>
              {document.expiryDate !== null && (
                <p className="warning">
                  Expires {document.expiryDate.slice(0, 10)}
                </p>
              )}
              <button
                onClick={() => void showDetails(document.id)}
                type="button"
              >
                Details and versions
              </button>
              <button
                disabled={document.status !== "READY"}
                onClick={() => void download(document.id)}
                type="button"
              >
                Download
              </button>
            </article>
          ))}
        </div>
        {selected !== null && (
          <section aria-labelledby="document-details-heading">
            <h2 id="document-details-heading">
              {selected.displayName} details
            </h2>
            <h3>Version history</h3>
            <ol>
              {selected.versions.map((version) => (
                <li key={version.id}>
                  Version {version.versionNumber}: {version.originalFilename},{" "}
                  {version.sizeBytes} bytes, uploaded{" "}
                  {new Date(version.createdAt).toLocaleDateString()}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
