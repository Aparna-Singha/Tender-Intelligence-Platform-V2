"use client";

import Link from "next/link";
import { useEffect, useState, type JSX } from "react";
import { apiRequest } from "../lib/api";

interface ChecklistRun {
  assessmentRunId: string;
  checklistPolicyVersion: string;
  completedAt: string | null;
  evidenceSnapshotId: string;
  id: string;
  invalidatedAt: string | null;
  progressPercentage: number;
  publicMessage: string;
  status: string;
}
interface ChecklistItem {
  completionCriteria: string;
  currentDueDate: string | null;
  currentPriority: string;
  currentTitle: string;
  dateIsOfficial: boolean;
  evidenceNeedCategory: string;
  id: string;
  itemType: string;
  proposedExplanation: string;
  status: string;
}
interface ChecklistResult {
  items: readonly ChecklistItem[];
  priority_counts: readonly { _count: number; currentPriority: string }[];
  status_counts: readonly { _count: number; status: string }[];
  total: number;
}

export function ActionChecklist({
  organisationId,
  tenderId,
  versionId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId: string;
}): JSX.Element {
  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const [runs, setRuns] = useState<readonly ChecklistRun[]>([]);
  const [runId, setRunId] = useState("");
  const [result, setResult] = useState<ChecklistResult | null>(null);
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");

  async function loadRuns(): Promise<void> {
    try {
      const loaded = await apiRequest<readonly ChecklistRun[]>(
        `${base}/versions/${versionId}/checklists`,
      );
      setRuns(loaded);
      setRunId((current) => (current === "" ? (loaded[0]?.id ?? "") : current));
    } catch {
      setMessage("Unable to load checklist history.");
    }
  }
  async function loadItems(): Promise<void> {
    if (runId === "") return;
    const query = status === "" ? "" : `?status=${status}`;
    try {
      setResult(
        await apiRequest<ChecklistResult>(
          `${base}/checklists/${runId}/items${query}`,
        ),
      );
    } catch {
      setResult(null);
    }
  }
  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => void loadRuns(), 5_000);
    return () => window.clearInterval(timer);
  }, [organisationId, tenderId, versionId]);
  useEffect(() => void loadItems(), [runId, status]);

  async function start(): Promise<void> {
    try {
      await apiRequest(`${base}/versions/${versionId}/checklists`, {
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
        method: "POST",
      });
      setMessage(
        "Checklist generation queued from the active Phase 7 snapshot.",
      );
      await loadRuns();
    } catch {
      setMessage(
        "Checklist generation requires current extraction, risk, CONTINUE, and Phase 7 evidence assessment inputs.",
      );
    }
  }
  async function transition(itemId: string, nextStatus: string): Promise<void> {
    const rationale = window.prompt(
      "Record a rationale (at least 10 characters).",
    );
    if (rationale === null) return;
    const blocked =
      nextStatus === "BLOCKED"
        ? window.prompt("Why is this item blocked?")
        : undefined;
    try {
      await apiRequest(`${base}/checklists/${runId}/items/${itemId}`, {
        body: JSON.stringify({
          ...(blocked === undefined ? {} : { blocked_reason: blocked }),
          ...(nextStatus === "DISMISSED"
            ? { dismissal_rationale: rationale }
            : {}),
          ...(nextStatus === "RESOLVED" ? { resolution_note: rationale } : {}),
          rationale,
          status: nextStatus,
        }),
        method: "PATCH",
      });
      await loadItems();
    } catch {
      setMessage(
        "The transition was rejected. Resolution requires current Phase 7 provenance; upload alone is insufficient.",
      );
    }
  }

  async function editWorkflow(
    itemId: string,
    field: "assignee_id" | "due_date",
  ): Promise<void> {
    const value = window.prompt(
      field === "assignee_id"
        ? "Enter an active organisation member UUID, or leave blank to unassign."
        : "Enter an internal target date as YYYY-MM-DD, or leave blank to clear it.",
    );
    if (value === null) return;
    const rationale = window.prompt(
      "Record a rationale (at least 10 characters).",
    );
    if (rationale === null) return;
    try {
      await apiRequest(`${base}/checklists/${runId}/items/${itemId}`, {
        body: JSON.stringify({
          [field]:
            value === ""
              ? null
              : field === "due_date"
                ? `${value}T00:00:00.000Z`
                : value,
          rationale,
        }),
        method: "PATCH",
      });
      await loadItems();
    } catch {
      setMessage("The assignment or internal target date was rejected.");
    }
  }

  const selected = runs.find((run) => run.id === runId);
  return (
    <section aria-labelledby="action-checklist-heading">
      <h2 id="action-checklist-heading">Missing documents and actions</h2>
      <p className="warning">
        This checklist is generated from the selected Phase 7 assessment
        snapshot. A missing checklist item does not itself determine overall
        eligibility.
      </p>
      <p>
        Uploading a document does not automatically prove compliance.
        Eligibility decisions remain human-controlled. Official tender deadlines
        are distinguished from internal target dates.
      </p>
      <button onClick={() => void start()} type="button">
        Generate current checklist
      </button>
      <p aria-live="polite">{message}</p>
      <label>
        Historical generation
        <select
          value={runId}
          onChange={(event) => setRunId(event.target.value)}
        >
          <option value="">No generation selected</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.status} · {run.checklistPolicyVersion}
            </option>
          ))}
        </select>
      </label>
      {selected !== undefined && (
        <p>
          {selected.status} · {selected.progressPercentage}% ·{" "}
          {selected.publicMessage}
          {selected.invalidatedAt === null ? "" : " · Historical/invalidated"}
        </p>
      )}
      <p>
        Checklist workflow progress:{" "}
        {result === null || result.total === 0
          ? "No items"
          : `${result.status_counts.find((count) => count.status === "RESOLVED")?._count ?? 0} of ${result.total} resolved`}
      </p>
      <label>
        Status filter
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All</option>
          {[
            "OPEN",
            "IN_PROGRESS",
            "BLOCKED",
            "READY_FOR_REASSESSMENT",
            "RESOLVED",
            "DISMISSED",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <p>
        <Link href={`/documents/${organisationId}`}>Open document vault</Link> ·
        Evidence Matrix is directly above this section.
      </p>
      {result?.items.length === 0 && (
        <p>No source-grounded actions were generated.</p>
      )}
      {result?.items.map((item) => (
        <article key={item.id} tabIndex={0}>
          <h3>{item.currentTitle}</h3>
          <p>
            {item.itemType} · {item.currentPriority} · {item.status}
          </p>
          <button
            onClick={() => void editWorkflow(item.id, "assignee_id")}
            type="button"
          >
            Assign or unassign
          </button>
          <button
            onClick={() => void editWorkflow(item.id, "due_date")}
            type="button"
          >
            Set internal target date
          </button>
          <p>{item.proposedExplanation}</p>
          <p>Completion criteria: {item.completionCriteria}</p>
          <p>
            Due:{" "}
            {item.currentDueDate === null
              ? "No reliable due date established"
              : `${new Date(item.currentDueDate).toLocaleDateString()} (${item.dateIsOfficial ? "official" : "internal"})`}
          </p>
          {item.status === "OPEN" && (
            <button
              onClick={() => void transition(item.id, "IN_PROGRESS")}
              type="button"
            >
              Start work
            </button>
          )}
          {["OPEN", "IN_PROGRESS"].includes(item.status) && (
            <button
              onClick={() => void transition(item.id, "BLOCKED")}
              type="button"
            >
              Mark blocked
            </button>
          )}
          {item.status === "IN_PROGRESS" && (
            <button
              onClick={() => void transition(item.id, "READY_FOR_REASSESSMENT")}
              type="button"
            >
              Ready for Phase 7 reassessment
            </button>
          )}
          {item.status === "BLOCKED" && (
            <button
              onClick={() => void transition(item.id, "IN_PROGRESS")}
              type="button"
            >
              Unblock and resume
            </button>
          )}
          {item.status === "READY_FOR_REASSESSMENT" && (
            <button
              onClick={() => void transition(item.id, "RESOLVED")}
              type="button"
            >
              Resolve from current Phase 7 result
            </button>
          )}
          {["OPEN", "IN_PROGRESS", "BLOCKED"].includes(item.status) && (
            <button
              onClick={() => void transition(item.id, "DISMISSED")}
              type="button"
            >
              Dismiss with rationale
            </button>
          )}
          {["RESOLVED", "DISMISSED"].includes(item.status) && (
            <button
              onClick={() => void transition(item.id, "OPEN")}
              type="button"
            >
              Reopen
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
