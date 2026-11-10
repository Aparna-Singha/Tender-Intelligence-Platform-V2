"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import { humanizeEnum } from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";

interface Attachment {
  attachment_id: string;
  detached_at: string | null;
  document_id: string;
  document_version_id: string;
  stale_requirement?: boolean;
  document: {
    displayName: string;
    expiryDate: string | null;
    status: string;
    verificationStatus: string;
  };
}

interface Fact {
  documentId: string;
  factType: string;
  id: string;
  invalidatedAt: string | null;
  currentVersion: {
    citations: readonly {
      boundedExcerpt: string;
      documentVersionId: string;
      id: string;
      pageNumber: number | null;
      validationStatus: string;
    }[];
    documentVersionId: string;
    id: string;
    reviewState: string;
    textValue: string | null;
    validUntil: string | null;
  } | null;
  reviews: readonly {
    action: string;
    actorUserId: string;
    createdAt: string;
    rationale: string;
  }[];
}

export function RequirementFactReview({
  assessmentId,
  canLink,
  organisationId,
  requirementId,
  linkedFactVersionIds,
  runId,
  tenderId,
  versionId,
  onEvidenceLinked,
}: {
  assessmentId: string;
  canLink: boolean;
  organisationId: string;
  requirementId: string;
  linkedFactVersionIds: readonly string[];
  runId: string;
  tenderId: string;
  versionId: string;
  onEvidenceLinked: () => Promise<void>;
}): JSX.Element {
  const attachmentPath = `/organisations/${organisationId}/tenders/${tenderId}/versions/${versionId}/requirements/${requirementId}/attachments`;
  const factPath = `/organisations/${organisationId}/company-evidence-facts`;
  const linkPath = `/organisations/${organisationId}/tenders/${tenderId}/eligibility-assessments/${runId}/items/${assessmentId}/evidence-links`;
  const [attachments, setAttachments] = useState<readonly Attachment[]>([]);
  const [facts, setFacts] = useState<readonly Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh(): Promise<void> {
    const [nextAttachments, nextFacts] = await Promise.all([
      apiRequest<readonly Attachment[]>(attachmentPath),
      apiRequest<readonly Fact[]>(factPath),
    ]);
    setAttachments(nextAttachments.filter((item) => item.detached_at === null));
    setFacts(nextFacts);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.resolve()
      .then(() =>
        Promise.all([
          apiRequest<readonly Attachment[]>(attachmentPath),
          apiRequest<readonly Fact[]>(factPath),
        ]),
      )
      .then(([nextAttachments, nextFacts]) => {
        if (!active) return;
        setAttachments(
          nextAttachments.filter((item) => item.detached_at === null),
        );
        setFacts(nextFacts);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(formatApiError(caught, "Evidence could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attachmentPath, factPath]);

  async function capture(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const selected = attachments.find(
      (item) => item.attachment_id === values.get("attachment_id"),
    );
    if (selected?.document.status !== "READY") return;
    setBusy(true);
    setError("");
    try {
      const fact = await apiRequest<{ id: string }>(factPath, {
        method: "POST",
        body: JSON.stringify({
          document_id: selected.document_id,
          document_version_id: selected.document_version_id,
          fact_type: values.get("fact_type"),
          value: { value_type: "TEXT", text_value: values.get("fact_value") },
        }),
      });
      const page = values.get("page_number");
      await apiRequest(`${factPath}/${fact.id}/citations`, {
        method: "POST",
        body: JSON.stringify({
          document_id: selected.document_id,
          document_version_id: selected.document_version_id,
          bounded_excerpt: values.get("excerpt"),
          ...(typeof page === "string" && page !== ""
            ? { page_number: Number(page) }
            : {}),
        }),
      });
      form.reset();
      await refresh();
      setMessage(
        "Cited fact saved. An authorised reviewer must decide whether to accept it. Refresh the requirements check before linking new evidence.",
      );
    } catch (caught) {
      setError(
        formatApiError(
          caught,
          "Fact capture failed. Check the exact source and retry.",
        ),
      );
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function review(
    event: FormEvent<HTMLFormElement>,
    factId: string,
  ): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await apiRequest(`${factPath}/${factId}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          action: values.get("action"),
          rationale: values.get("rationale"),
        }),
      });
      await refresh();
      setMessage(
        "Fact review recorded. Refresh the requirements check before linking newly accepted evidence.",
      );
    } catch (caught) {
      setError(formatApiError(caught, "Fact review was rejected."));
    } finally {
      setBusy(false);
    }
  }

  async function link(fact: Fact): Promise<void> {
    if (busy || fact.currentVersion === null) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(linkPath, {
        method: "POST",
        body: JSON.stringify({
          evidence_fact_version_id: fact.currentVersion.id,
          link_type: "DIRECT_SUPPORT",
        }),
      });
      await onEvidenceLinked();
      setMessage(
        "Accepted cited fact linked as direct support. A human assessment decision is still required.",
      );
    } catch (caught) {
      setError(
        formatApiError(
          caught,
          "Link failed. Refresh the requirements check if this fact is absent from the assessment snapshot.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const ready = attachments.filter((item) => item.document.status === "READY");
  const related = facts.filter((fact) =>
    attachments.some(
      (item) =>
        item.document_id === fact.documentId &&
        item.document_version_id === fact.currentVersion?.documentVersionId,
    ),
  );

  return (
    <section
      aria-label="Facts for this requirement"
      className="requirement-fact-review"
    >
      <h4>Cited facts for this requirement</h4>
      <p>
        Attachments are context. An accepted fact and a direct link do not by
        themselves verify eligibility.
      </p>
      {!canLink && (
        <p role="status">
          This assessment needs a fresh requirements check before linking direct
          support.
        </p>
      )}
      {loading && <p role="status">Loading attached evidence facts…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!loading && (
        <button
          disabled={busy}
          onClick={() =>
            void refresh().catch((caught: unknown) =>
              setError(
                formatApiError(caught, "Evidence could not be refreshed."),
              ),
            )
          }
          type="button"
        >
          Refresh facts
        </button>
      )}
      {!loading && attachments.length === 0 && (
        <p>No document is attached to this requirement.</p>
      )}
      {attachments.map((item) => (
        <p key={item.attachment_id}>
          {item.document.displayName} · {humanizeEnum(item.document.status)} ·{" "}
          {item.document.verificationStatus === "VERIFIED"
            ? "Document verified"
            : "Document not independently verified"}
          {item.document.expiryDate &&
            ` · Expiry date: ${item.document.expiryDate.slice(0, 10)}`}
          {item.stale_requirement && " · Requirement changed; reassess"}
        </p>
      ))}
      {!loading && attachments.length > 0 && ready.length === 0 && (
        <p>
          Attached documents are still pending processing or failed. A READY
          source is required to capture a fact.
        </p>
      )}
      {ready.length > 0 && (
        <form onSubmit={(event) => void capture(event)}>
          <h5>Capture a fact from an attached document</h5>
          <label>
            Attached READY document
            <select name="attachment_id" required>
              <option value="">Choose document</option>
              {ready.map((item) => (
                <option key={item.attachment_id} value={item.attachment_id}>
                  {item.document.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fact type{" "}
            <input
              name="fact_type"
              pattern="[A-Z][A-Z0-9_]{1,79}"
              placeholder="GST_REGISTRATION"
              required
            />
          </label>
          <label>
            Exact fact value <input name="fact_value" required />
          </label>
          <label>
            Page number, if shown{" "}
            <input min={1} name="page_number" type="number" />
          </label>
          <label>
            Bounded source excerpt{" "}
            <textarea maxLength={1000} name="excerpt" required />
          </label>
          <button disabled={busy} type="submit">
            Save cited fact for review
          </button>
        </form>
      )}
      {!loading && related.length === 0 && attachments.length > 0 && (
        <p>No fact cites an attached document version yet.</p>
      )}
      {related.map((fact) => {
        const version = fact.currentVersion;
        const accepted =
          fact.invalidatedAt === null && version?.reviewState === "ACCEPTED";
        const validCitation =
          version?.citations.some(
            (citation) => citation.validationStatus === "VALID",
          ) ?? false;
        return (
          <article key={fact.id}>
            <h5>{humanizeEnum(fact.factType)}</h5>
            <p>
              {version?.textValue ?? "Value unavailable"} ·{" "}
              {humanizeEnum(version?.reviewState ?? "UNREVIEWED")}
            </p>
            {version?.validUntil && <p>Valid until {version.validUntil}</p>}
            {version?.citations.map((citation) => (
              <blockquote key={citation.id}>
                {citation.boundedExcerpt}
                {citation.pageNumber === null
                  ? ""
                  : ` · page ${citation.pageNumber}`}
              </blockquote>
            ))}
            {fact.reviews.map((entry, index) => (
              <p key={index}>
                Organisation review by account {entry.actorUserId}:{" "}
                {humanizeEnum(entry.action)} · {entry.rationale}
              </p>
            ))}
            {fact.invalidatedAt === null && (
              <form onSubmit={(event) => void review(event, fact.id)}>
                <label>
                  Fact review decision{" "}
                  <select name="action">
                    <option value="REQUEST_HUMAN_REVIEW">Request review</option>
                    {!fact.factType.endsWith("_CONFLICT") && (
                      <option value="ACCEPT">Accept cited fact</option>
                    )}
                    <option value="REJECT">Reject</option>
                  </select>
                </label>
                <label>
                  Review rationale{" "}
                  <textarea
                    minLength={10}
                    maxLength={1000}
                    name="rationale"
                    required
                  />
                </label>
                <button disabled={busy} type="submit">
                  Record fact review
                </button>
              </form>
            )}
            {accepted &&
              canLink &&
              validCitation &&
              !linkedFactVersionIds.includes(version.id) && (
                <button
                  disabled={busy}
                  onClick={() => void link(fact)}
                  type="button"
                >
                  Link accepted fact as direct support
                </button>
              )}
            {accepted && !validCitation && (
              <p role="status">
                The accepted fact has no valid current citation.
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
