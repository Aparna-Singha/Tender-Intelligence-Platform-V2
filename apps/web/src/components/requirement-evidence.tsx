"use client";

import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";
import { Button, Input, Modal } from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { uploadFileToSignedStorageUrl } from "../lib/direct-upload";

const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const maxBytes = 25 * 1024 * 1024;

export interface Attachment {
  attachment_id: string;
  context_only: boolean;
  detached_at: string | null;
  stale_requirement: boolean;
  document: {
    displayName: string;
    status: string;
    verificationStatus: string;
    expiryDate: string | null;
  };
  version: {
    originalFilename: string;
    uploadSession: { status: string } | null;
  };
}
interface Candidate {
  id: string;
  displayName: string;
  status: string;
  verificationStatus: string;
  expiryDate: string | null;
  currentVersion: { id: string; versionNumber: number } | null;
}
interface CandidateResult {
  items: Candidate[];
}
interface UploadSession {
  attachment_id: string;
  upload_session_id: string;
  upload_url: string | null;
}

export function RequirementEvidence({
  organisationId,
  tenderId,
  versionId,
  requirementId,
  canEdit = true,
  previewItems,
}: {
  organisationId: string;
  tenderId: string;
  versionId: string;
  requirementId: string;
  canEdit?: boolean;
  previewItems?: readonly Attachment[];
}): JSX.Element {
  const base = `/organisations/${organisationId}/tenders/${tenderId}/versions/${versionId}/requirements/${requirementId}`;
  const [items, setItems] = useState<readonly Attachment[]>(previewItems ?? []);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const requestKey = useRef<string | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const editable = canEdit && previewItems === undefined;

  async function refresh(): Promise<void> {
    const result = await apiRequest<Attachment[]>(`${base}/attachments`, {});
    setItems(Array.isArray(result) ? result : []);
  }
  useEffect(() => {
    if (previewItems) return;
    let active = true;
    void Promise.resolve()
      .then(() => apiRequest<Attachment[]>(`${base}/attachments`, {}))
      .then((result) => {
        if (active) setItems(Array.isArray(result) ? result : []);
      })
      .catch((caught) => {
        if (active)
          setError(
            formatApiError(caught, "Evidence request failed. Please retry."),
          );
      });
    return () => {
      active = false;
    };
  }, [base]);
  useEffect(() => {
    if (!pickerOpen) return;
    let active = true;
    void Promise.resolve()
      .then(() =>
        apiRequest<CandidateResult>(
          `${base}/evidence-candidates?search=${encodeURIComponent(search)}&limit=50`,
          {},
        ),
      )
      .then((result) => {
        if (active)
          setCandidates(Array.isArray(result?.items) ? result.items : []);
      })
      .catch((caught) => {
        if (active)
          setError(
            formatApiError(caught, "Evidence request failed. Please retry."),
          );
      });
    return () => {
      active = false;
    };
  }, [base, pickerOpen, search]);

  async function upload(file: File): Promise<void> {
    setError("");
    setMessage("");
    if (!allowedTypes.has(file.type)) {
      setError("This file type is not supported.");
      return;
    }
    if (file.size === 0 || file.size > maxBytes) {
      setError("Choose a file smaller than 25 MB.");
      return;
    }
    setRetryFile(file);
    setBusy(true);
    let session: UploadSession | null = null;
    try {
      const checksum = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
      )
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      requestKey.current ??= crypto.randomUUID();
      session = await apiRequest<UploadSession>(`${base}/upload-sessions`, {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          checksum_sha256: checksum,
          idempotency_key: requestKey.current,
        }),
      });
      await refresh();
      if (!session.upload_url)
        throw new Error("Upload session expired. Choose the file again.");
      await uploadFileToSignedStorageUrl(session.upload_url, file, checksum);
      await apiRequest(
        `${base}/upload-sessions/${session.upload_session_id}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ checksum_sha256: checksum }),
        },
      );
      requestKey.current = null;
      setRetryFile(null);
      setMessage(
        "File attached. Security processing and evidence review are still required.",
      );
      await refresh();
    } catch (caught) {
      setError(
        formatApiError(caught, "Evidence request failed. Please retry."),
      );
      if (session) await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function attach(candidate: Candidate): Promise<void> {
    if (!candidate.currentVersion) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`${base}/attachments`, {
        method: "POST",
        body: JSON.stringify({
          document_id: candidate.id,
          document_version_id: candidate.currentVersion.id,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      await refresh();
      setPickerOpen(false);
      setMessage(
        "Document attached as context. A reviewer must still assess the evidence.",
      );
    } catch (caught) {
      setError(
        formatApiError(caught, "Evidence request failed. Please retry."),
      );
    } finally {
      setBusy(false);
    }
  }
  async function detach(id: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`${base}/attachments/${id}`, { method: "DELETE" });
      await refresh();
      setMessage(
        "Attachment removed. The original document remains available.",
      );
    } catch (caught) {
      setError(
        formatApiError(caught, "Evidence request failed. Please retry."),
      );
    } finally {
      setBusy(false);
    }
  }
  const active = items.filter((item) => item.detached_at === null);
  return (
    <div className="requirement-evidence-panel">
      <h4>Your documents</h4>
      <p>
        Attached documents are context for human review, not proof of
        eligibility.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {active.length === 0 && (
        <p>No documents attached to this requirement yet.</p>
      )}
      <ul>
        {active.map((item) => (
          <li key={item.attachment_id}>
            <strong>
              {item.document.displayName || item.version.originalFilename}
            </strong>{" "}
            <span role="status">
              {item.version.uploadSession?.status === "PENDING"
                ? "Upload pending"
                : item.version.uploadSession?.status === "EXPIRED"
                  ? "Upload expired"
                  : item.version.uploadSession?.status === "CANCELLED"
                    ? "Upload cancelled"
                    : item.document.status === "FAILED"
                      ? "Processing failed"
                      : item.document.status === "UPLOADED"
                        ? "Security processing pending"
                        : item.document.status === "SCANNING" ||
                            item.document.status === "PROCESSING"
                          ? "Security processing in progress"
                          : item.document.status === "READY"
                            ? "Document ready"
                            : item.document.status}
            </span>
            {item.document.verificationStatus !== "VERIFIED" && (
              <span> · Not independently verified</span>
            )}
            {item.document.expiryDate &&
              new Date(item.document.expiryDate) < new Date() && (
                <span> · Expired</span>
              )}
            {item.stale_requirement && (
              <span> · Requirement changed; review again</span>
            )}
            {editable && (
              <Button
                disabled={busy}
                onClick={() => void detach(item.attachment_id)}
                variant="secondary"
              >
                Detach
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <>
          <input
            aria-label="Upload evidence document"
            accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
            ref={input}
            style={{ display: "none" }}
            type="file"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Working..." : "Upload document"}
          </Button>{" "}
          {retryFile && !busy && (
            <Button onClick={() => void upload(retryFile)} variant="secondary">
              Retry upload
            </Button>
          )}{" "}
          <Button
            disabled={busy}
            onClick={() => setPickerOpen(true)}
            variant="secondary"
          >
            Choose existing document
          </Button>
        </>
      )}
      {pickerOpen && (
        <Modal
          label="Choose existing document"
          onClose={() => setPickerOpen(false)}
        >
          <h2>Choose existing document</h2>
          <label htmlFor="evidence-search">Search documents</label>
          <Input
            id="evidence-search"
            onChange={(event) => setSearch(event.target.value)}
            value={search}
          />
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <strong>{candidate.displayName}</strong> · Version{" "}
                {candidate.currentVersion?.versionNumber ?? "—"} ·{" "}
                {candidate.verificationStatus}
                {candidate.expiryDate &&
                  new Date(candidate.expiryDate) < new Date() &&
                  " · Expired"}
                <Button
                  disabled={busy || !candidate.currentVersion}
                  onClick={() => void attach(candidate)}
                  variant="secondary"
                >
                  Attach
                </Button>
              </li>
            ))}
          </ul>
          <Button onClick={() => setPickerOpen(false)} variant="secondary">
            Close
          </Button>
        </Modal>
      )}
    </div>
  );
}
