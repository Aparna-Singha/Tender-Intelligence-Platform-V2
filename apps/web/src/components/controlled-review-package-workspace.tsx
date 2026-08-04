"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";

interface Issue {
  code: string;
  treatment:
    | "HARD_GENERATION_BLOCKER"
    | "PACKAGE_WARNING"
    | "REVIEW_BLOCKER"
    | "DOWNLOAD_BLOCKER";
}
interface Preflight {
  active_run: { id: string } | null;
  eligible_independent_approver_exists: boolean;
  hard_prerequisites_pass: boolean;
  issues: readonly Issue[];
  qualifying_export_template_version_id: string | null;
  transactional_revalidation_required: true;
}
interface PackageRun {
  artifact_id: string | null;
  created_at: string;
  failure_code: string | null;
  freshness: "CURRENT" | "STALE" | "INVALIDATED";
  generation_status: string;
  id: string;
  input_fingerprint: string;
  is_current: boolean;
  requested_by: { display_name: string; role_at_action: string };
  review_status: string;
  review_version?: number;
}
interface History {
  items: readonly PackageRun[];
}
interface Reviews {
  items: readonly {
    actor: { display_name: string; role_at_action: string };
    comment: string;
    created_at: string;
    id: string;
    outcome: string;
    review_version: number;
  }[];
}

const base = (organisationId: string, tenderId: string): string =>
  `/organisations/${organisationId}/tenders/${tenderId}`;
const idempotencyKey = (): string => crypto.randomUUID();

export function ControlledReviewPackageWorkspace({
  organisationId,
  tenderId,
  versionId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId: string;
}): JSX.Element {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [history, setHistory] = useState<readonly PackageRun[]>([]);
  const [selected, setSelected] = useState<PackageRun | null>(null);
  const [reviews, setReviews] = useState<Reviews["items"]>([]);
  const [message, setMessage] = useState("Loading controlled-review status…");
  const root = base(organisationId, tenderId);

  async function load(preferredId?: string): Promise<void> {
    try {
      const [nextPreflight, nextHistory] = await Promise.all([
        apiRequest<Preflight>(`${root}/controlled-review-packages/preflight`),
        apiRequest<History>(
          `${root}/versions/${versionId}/controlled-review-packages`,
        ),
      ]);
      const id =
        preferredId ??
        selected?.id ??
        nextPreflight.active_run?.id ??
        nextHistory.items[0]?.id;
      const detail =
        id === undefined
          ? null
          : await apiRequest<PackageRun>(
              `${root}/controlled-review-packages/${id}`,
            );
      const reviewHistory =
        id === undefined
          ? { items: [] }
          : await apiRequest<Reviews>(
              `${root}/controlled-review-packages/${id}/reviews`,
            );
      setPreflight(nextPreflight);
      setHistory(nextHistory.items);
      setSelected(detail);
      setReviews(reviewHistory.items);
      setMessage("");
    } catch (error) {
      setMessage(
        formatApiError(error, "Unable to load controlled-review packages."),
      );
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [organisationId, tenderId, versionId]);

  async function mutate(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ): Promise<void> {
    try {
      const result = await apiRequest<{ package_id?: string }>(path, {
        body: JSON.stringify(body),
        method,
      });
      setMessage(success);
      await load(result.package_id);
    } catch (error) {
      setMessage(
        formatApiError(
          error,
          "The controlled-review action could not be completed.",
        ),
      );
    }
  }
  async function generate(): Promise<void> {
    if (
      !window.confirm(
        "Generate an immutable package for controlled human review only? This does not submit the tender.",
      )
    )
      return;
    await mutate(
      `${root}/controlled-review-packages`,
      "POST",
      { idempotency_key: idempotencyKey() },
      "Generation requested. Transactional prerequisites were revalidated.",
    );
  }
  async function submitReview(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (selected === null) return;
    const data = new FormData(event.currentTarget);
    await mutate(
      `${root}/controlled-review-packages/${selected.id}/reviews`,
      "POST",
      {
        comment: data.get("comment"),
        expected_review_version: reviews.at(-1)?.review_version ?? 0,
        outcome: "REVIEW_COMPLETE",
      },
      "Append-only review recorded.",
    );
  }
  async function decide(
    outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD" | "REJECTED",
  ): Promise<void> {
    if (selected === null) return;
    const rationale = window.prompt(
      outcome === "REJECTED"
        ? "Rejection rationale (correction requires regeneration)"
        : "Independent approval rationale",
    );
    if (rationale === null) return;
    await mutate(
      `${root}/controlled-review-packages/${selected.id}/decisions`,
      "POST",
      {
        expected_fingerprint: selected.input_fingerprint,
        expected_review_version: reviews.at(-1)?.review_version ?? 0,
        outcome,
        rationale,
      },
      outcome === "REJECTED"
        ? "Package rejected; regenerate after correction."
        : "Approved for controlled download.",
    );
  }
  async function download(): Promise<void> {
    if (selected?.artifact_id === null || selected === null) return;
    try {
      const grant = await apiRequest<{ download_path: string }>(
        `${root}/controlled-review-packages/${selected.id}/download-grants`,
        {
          body: JSON.stringify({ artifact_id: selected.artifact_id }),
          method: "POST",
        },
      );
      const redemption = await apiRequest<{ download_url: string }>(
        grant.download_path,
      );
      window.location.assign(redemption.download_url);
    } catch (error) {
      setMessage(
        formatApiError(
          error,
          "The controlled download could not be authorised.",
        ),
      );
    }
  }

  const grouped = (treatment: Issue["treatment"]): readonly Issue[] =>
    preflight?.issues.filter((issue) => issue.treatment === treatment) ?? [];
  return (
    <section aria-labelledby="controlled-package-heading">
      <h2 id="controlled-package-heading">Controlled review package</h2>
      <Alert tone="warning">
        <p>
          Packages are for authorised human review only. Generation and
          controlled-download approval do not approve or perform external
          submission, certify compliance, eligibility, completeness, or bid
          success.
        </p>
      </Alert>
      <p aria-live="polite">{message}</p>
      {preflight === null ? (
        <p>Loading informational preflight…</p>
      ) : (
        <>
          <Card>
            <h3>Informational preflight</h3>
            <p>
              {preflight.hard_prerequisites_pass
                ? "Hard generation prerequisites currently pass."
                : "Generation has hard blockers."}{" "}
              The start transaction always revalidates authority.
            </p>
            <p>
              Independent approver:{" "}
              {preflight.eligible_independent_approver_exists
                ? "available"
                : "not available"}
            </p>
          </Card>
          {(
            [
              "HARD_GENERATION_BLOCKER",
              "PACKAGE_WARNING",
              "REVIEW_BLOCKER",
              "DOWNLOAD_BLOCKER",
            ] as const
          ).map((treatment) => (
            <div key={treatment}>
              <h3>{humanizeEnum(treatment)}</h3>
              {grouped(treatment).length === 0 ? (
                <p>None reported.</p>
              ) : (
                <ul>
                  {grouped(treatment).map((issue) => (
                    <li key={`${treatment}:${issue.code}`}>
                      {humanizeEnum(issue.code)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <Button
            disabled={!preflight.hard_prerequisites_pass}
            onClick={() => void generate()}
          >
            Generate review package
          </Button>
        </>
      )}
      <h3>Package history</h3>
      {history.length === 0 ? (
        <EmptyState
          title="No review packages"
          description="A valid Phase 11 Proceed decision is required before generation."
        />
      ) : (
        <ul>
          {history.map((run) => (
            <li key={run.id}>
              <button onClick={() => void load(run.id)} type="button">
                {new Date(run.created_at).toLocaleString()} ·{" "}
                {humanizeEnum(run.generation_status)} ·{" "}
                {humanizeEnum(run.review_status)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected !== null && (
        <article>
          <h3>Selected immutable run</h3>
          <p>
            <Badge>{humanizeEnum(selected.generation_status)}</Badge>{" "}
            <Badge>{humanizeEnum(selected.freshness)}</Badge>{" "}
            <Badge>{humanizeEnum(selected.review_status)}</Badge>
          </p>
          <p>
            Requested by {selected.requested_by.display_name} (
            {humanizeEnum(selected.requested_by.role_at_action)} at action).
          </p>
          {selected.failure_code !== null && (
            <Alert tone="danger">
              <p>
                Generation failed safely: {humanizeEnum(selected.failure_code)}
              </p>
            </Alert>
          )}
          {(["QUEUED", "PROCESSING"] as const).includes(
            selected.generation_status as "QUEUED",
          ) && (
            <Button
              onClick={() =>
                void mutate(
                  `${root}/controlled-review-packages/${selected.id}`,
                  "DELETE",
                  {
                    rationale:
                      "Cancellation requested during controlled package generation.",
                  },
                  "Cancellation requested; the worker will stop after observing it.",
                )
              }
            >
              Request cancellation
            </Button>
          )}
          {(["FAILED", "CANCELLED", "INVALIDATED"] as const).includes(
            selected.generation_status as "FAILED",
          ) && (
            <Button
              onClick={() =>
                void mutate(
                  `${root}/controlled-review-packages/${selected.id}/retry`,
                  "POST",
                  {
                    idempotency_key: idempotencyKey(),
                    rationale:
                      "Create a new immutable package run after the prior terminal result.",
                  },
                  "A new immutable retry run was requested.",
                )
              }
            >
              Regenerate as new run
            </Button>
          )}
          {selected.generation_status === "GENERATED" && (
            <>
              <form onSubmit={(event) => void submitReview(event)}>
                <label>
                  Append-only review comment
                  <textarea
                    minLength={1}
                    maxLength={2000}
                    name="comment"
                    required
                  />
                </label>
                <Button type="submit">Record review complete</Button>
              </form>
              <h4>Review history</h4>
              {reviews.map((review) => (
                <p key={review.id}>
                  {review.actor.display_name} (
                  {humanizeEnum(review.actor.role_at_action)}) ·{" "}
                  {humanizeEnum(review.outcome)} · {review.comment}
                </p>
              ))}
              <Button
                onClick={() => void decide("APPROVED_FOR_CONTROLLED_DOWNLOAD")}
              >
                Approve for controlled download
              </Button>
              <Button variant="quiet" onClick={() => void decide("REJECTED")}>
                Reject package
              </Button>
              {selected.review_status === "APPROVED" && (
                <Button onClick={() => void download()}>
                  Authorise one-minute download
                </Button>
              )}
            </>
          )}
        </article>
      )}
    </section>
  );
}
