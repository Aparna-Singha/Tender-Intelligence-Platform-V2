"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type JSX } from "react";
import { apiRequest } from "../lib/api";
import { ExtractionWorkspace } from "./extraction-workspace";
import { RiskWorkspace } from "./risk-workspace";
import { EvidenceMatrix } from "./evidence-matrix";
import { ActionChecklist } from "./action-checklist";
import { RagChatbot } from "./rag-chatbot";

interface Workspace {
  buyer: string;
  corrigenda: readonly {
    description: string;
    id: string;
    identifier: string;
    publicationDate: string | null;
  }[];
  demonstration_label?: string;
  id: string;
  lifecycleStatus: string;
  processingJobs: readonly {
    currentStage: string;
    id: string;
    progressPercentage: number;
    publicMessage: string;
    state: string;
  }[];
  sources: readonly {
    adapterType: string;
    provenance: string;
    sourceName: string;
    sourceUrl: string | null;
  }[];
  title: string;
  versions: readonly {
    documents: readonly {
      displayFilename: string;
      id: string;
      role: string;
      sha256: string;
      status: string;
    }[];
    id: string;
    reason: string;
    versionNumber: number;
  }[];
  workspace: { processingProgress: number; sourceSectionStatus: string };
}

interface UploadSession {
  document_id: string;
  upload_url: string;
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

export function TenderWorkspace({
  organisationId,
  tenderId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
}): JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [message, setMessage] = useState("Loading workspace…");
  const [selectedVersionId, setSelectedVersionId] = useState("");

  async function load(): Promise<void> {
    try {
      const loaded = await apiRequest<Workspace>(
        `/organisations/${organisationId}/tenders/${tenderId}`,
      );
      setWorkspace(loaded);
      setSelectedVersionId((current) =>
        current === "" ? (loaded.versions[0]?.id ?? "") : current,
      );
      setMessage("");
    } catch {
      setMessage("Unable to load this tender workspace.");
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [organisationId, tenderId]);

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (workspace === null) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const files = values
      .getAll("file")
      .filter(
        (value): value is File => value instanceof File && value.size > 0,
      );
    const role = values.get("role");
    const version = workspace.versions[0];
    if (files.length === 0 || version === undefined || typeof role !== "string")
      return;
    if (role === "CORRIGENDUM" && files.length !== 1) {
      setMessage(
        "Upload one corrigendum at a time to preserve version history.",
      );
      return;
    }
    setMessage("Preparing secure direct upload…");
    try {
      for (const [index, file] of files.entries()) {
        setMessage(`Uploading source ${index + 1} of ${files.length}…`);
        const checksum = await sha256(file);
        let targetVersionId = version.id;
        if (role === "CORRIGENDUM") {
          const identifier = values.get("corrigendum_identifier");
          const description = values.get("corrigendum_description");
          if (
            typeof identifier !== "string" ||
            identifier.length === 0 ||
            typeof description !== "string" ||
            description.length === 0
          )
            throw new Error("Corrigendum metadata is required");
          const result = await apiRequest<{ version_id: string }>(
            `/organisations/${organisationId}/tenders/${tenderId}/corrigenda`,
            {
              body: JSON.stringify({
                checksum_sha256: checksum,
                description,
                identifier,
              }),
              method: "POST",
            },
          );
          targetVersionId = result.version_id;
        }
        const session = await apiRequest<UploadSession>(
          `/organisations/${organisationId}/tenders/${tenderId}/versions/${targetVersionId}/upload-sessions`,
          {
            body: JSON.stringify({
              checksum_sha256: checksum,
              filename: file.name,
              mime_type: file.type,
              role,
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
          `/organisations/${organisationId}/tenders/${tenderId}/documents/${session.document_id}/complete`,
          {
            body: JSON.stringify({ checksum_sha256: checksum }),
            method: "POST",
          },
        );
      }
      form.reset();
      setMessage("Upload accepted. Security processing is in progress.");
      await load();
    } catch {
      setMessage("Upload rejected. Check the file type, size, and contents.");
    }
  }

  async function download(documentId: string): Promise<void> {
    const result = await apiRequest<{ download_url: string }>(
      `/organisations/${organisationId}/tenders/${tenderId}/documents/${documentId}/download`,
      { method: "POST" },
    );
    window.location.assign(result.download_url);
  }

  return (
    <main>
      <div className="panel">
        <Link href={`/tenders/${organisationId}`}>All tender workspaces</Link>
        <h1>{workspace?.title ?? "Tender workspace"}</h1>
        {workspace?.demonstration_label !== undefined && (
          <p className="warning">{workspace.demonstration_label}</p>
        )}
        <p>{workspace?.buyer}</p>
        <section>
          <h2>Source and processing</h2>
          <p>
            Status: {workspace?.lifecycleStatus ?? "Loading"} ·{" "}
            {workspace?.workspace.processingProgress ?? 0}%
          </p>
          {workspace?.sources.map((source) => (
            <article key={`${source.adapterType}:${source.sourceName}`}>
              <h3>{source.sourceName}</h3>
              <p>{source.provenance}</p>
              {source.sourceUrl !== null && (
                <a href={source.sourceUrl} rel="noreferrer" target="_blank">
                  Official source
                </a>
              )}
            </article>
          ))}
          <form onSubmit={(event) => void upload(event)}>
            <label>
              Document role
              <select name="role">
                <option value="PRIMARY">Primary tender</option>
                <option value="ANNEXURE">Annexure</option>
                <option value="BOQ">BOQ</option>
                <option value="TECHNICAL_SPECIFICATION">
                  Technical specification
                </option>
                <option value="FORM">Form</option>
                <option value="DECLARATION">Declaration</option>
                <option value="CORRIGENDUM">Corrigendum</option>
                <option value="AMENDMENT">Amendment</option>
                <option value="CLARIFICATION">Buyer clarification</option>
                <option value="SUPPORTING">Supporting document</option>
              </select>
            </label>
            <label>
              Corrigendum identifier (required for corrigendum role)
              <input name="corrigendum_identifier" />
            </label>
            <label>
              Corrigendum description (required for corrigendum role)
              <input name="corrigendum_description" />
            </label>
            <label>
              PDF, ZIP, XLSX, DOCX, or CSV (maximum 25 MiB)
              <input
                accept=".pdf,.zip,.xlsx,.docx,.csv"
                multiple
                name="file"
                required
                type="file"
              />
            </label>
            <button type="submit">Upload source securely</button>
          </form>
          <p aria-live="polite">{message}</p>
          <label>
            Source version
            <select
              value={selectedVersionId}
              onChange={(event) => setSelectedVersionId(event.target.value)}
            >
              {workspace?.versions.map((version, index) => (
                <option key={version.id} value={version.id}>
                  Version {version.versionNumber}
                  {index === 0 ? " — current" : ""}
                </option>
              ))}
            </select>
          </label>
          {workspace?.versions
            .filter((version) => version.id === selectedVersionId)
            .map((version) => (
              <article key={version.id}>
                <h3>Version {version.versionNumber}</h3>
                <p>{version.reason}</p>
                {version.documents.map((document) => (
                  <p key={document.id}>
                    {document.displayFilename} · {document.role} ·{" "}
                    {document.status} · SHA-256 {document.sha256.slice(0, 12)}…
                    <button
                      disabled={document.status !== "READY"}
                      onClick={() => void download(document.id)}
                      type="button"
                    >
                      Download
                    </button>
                  </p>
                ))}
              </article>
            ))}
          <h3>Processing timeline</h3>
          {workspace?.processingJobs.length === 0 && (
            <p>No source-processing jobs have started.</p>
          )}
          {workspace?.processingJobs.map((job) => (
            <p key={job.id}>
              {job.state} · {job.progressPercentage}% · {job.publicMessage}
            </p>
          ))}
          <h3>Corrigendum history</h3>
          {workspace?.corrigenda.length === 0 && (
            <p>No corrigenda have been recorded.</p>
          )}
          {workspace?.corrigenda.map((corrigendum) => (
            <p key={corrigendum.id}>
              {corrigendum.identifier} · {corrigendum.description}
            </p>
          ))}
        </section>
        {workspace?.versions[0]?.id !== undefined && (
          <ExtractionWorkspace
            organisationId={organisationId}
            tenderId={tenderId}
            versionId={workspace.versions[0].id}
          />
        )}
        {workspace?.versions[0]?.id !== undefined && (
          <RiskWorkspace
            organisationId={organisationId}
            tenderId={tenderId}
            versionId={workspace.versions[0].id}
          />
        )}
        {workspace?.versions[0]?.id !== undefined && (
          <EvidenceMatrix
            organisationId={organisationId}
            tenderId={tenderId}
            versionId={workspace.versions[0].id}
          />
        )}
        {workspace?.versions[0]?.id !== undefined && (
          <ActionChecklist
            organisationId={organisationId}
            tenderId={tenderId}
            versionId={workspace.versions[0].id}
          />
        )}
        {workspace?.versions[0]?.id !== undefined && (
          <RagChatbot
            organisationId={organisationId}
            tenderId={tenderId}
            versionId={workspace.versions[0].id}
          />
        )}
        {["Draft", "Readiness audit", "Export"].map((section) => (
          <section key={section}>
            <h2>{section}</h2>
            <p>Not implemented in this phase.</p>
          </section>
        ))}
      </div>
    </main>
  );
}
