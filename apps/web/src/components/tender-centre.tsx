"use client";

import { Plus, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import {
  Button,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  Modal,
  Select,
} from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { assistantHref } from "../lib/assistant";
import {
  describeTender,
  formatDeadline,
  formatDeadlineCountdown,
  type TenderSummary,
} from "./tender-presentation";

interface CreatedTender {
  readonly tender_id: string;
}

type StatusFilter = "ALL" | "ACTIVE" | "NEEDS_ATTENTION" | "DRAFTS" | "ON_HOLD";
type SortMode = "DEADLINE" | "TITLE";

function optionalText(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function matchesStatusFilter(
  tender: TenderSummary,
  filter: StatusFilter,
): boolean {
  const presentation = describeTender(tender);
  if (filter === "ACTIVE") return !presentation.isCompleted;
  if (filter === "NEEDS_ATTENTION") return presentation.needsAttention;
  if (filter === "DRAFTS") return presentation.isDraft;
  if (filter === "ON_HOLD") return presentation.onHold;
  return true;
}

export function TenderCentre({
  organisationId,
}: {
  readonly organisationId: string;
}): JSX.Element {
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);
  const [message, setMessage] = useState("Loading tender workspaces...");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("DEADLINE");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function load(): Promise<void> {
    try {
      setTenders(
        await apiRequest<TenderSummary[]>(
          `/organisations/${organisationId}/tenders`,
        ),
      );
      setMessage("");
    } catch (caught) {
      setMessage(formatApiError(caught, "Unable to load tender workspaces."));
    }
  }

  useEffect(() => {
    void load();
  }, [organisationId]);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const deadline = values.get("submission_deadline");
    if (typeof deadline !== "string") return;
    setSubmitting(true);
    setError("");
    try {
      const created = await apiRequest<CreatedTender>(
        `/organisations/${organisationId}/tenders`,
        {
          body: JSON.stringify({
            buyer: values.get("buyer"),
            category: optionalText(values.get("category")),
            description: optionalText(values.get("description")),
            official_source_url: optionalText(
              values.get("official_source_url"),
            ),
            publication_date: optionalText(values.get("publication_date")),
            source_tender_number: optionalText(
              values.get("source_tender_number"),
            ),
            submission_deadline: new Date(deadline).toISOString(),
            title: values.get("title"),
          }),
          method: "POST",
        },
      );
      form.reset();
      window.location.assign(`/tenders/${organisationId}/${created.tender_id}`);
    } catch (caught) {
      setError(
        formatApiError(caught, "Tender workspace could not be created."),
      );
      setSubmitting(false);
    }
  }

  const counts = useMemo(
    () => ({
      ACTIVE: tenders.filter((tender) => matchesStatusFilter(tender, "ACTIVE"))
        .length,
      ALL: tenders.length,
      DRAFTS: tenders.filter((tender) => matchesStatusFilter(tender, "DRAFTS"))
        .length,
      NEEDS_ATTENTION: tenders.filter((tender) =>
        matchesStatusFilter(tender, "NEEDS_ATTENTION"),
      ).length,
      ON_HOLD: tenders.filter((tender) =>
        matchesStatusFilter(tender, "ON_HOLD"),
      ).length,
    }),
    [tenders],
  );

  const visibleTenders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...tenders]
      .filter((tender) => matchesStatusFilter(tender, statusFilter))
      .filter((tender) => {
        if (query === "") return true;
        return [tender.title, tender.buyer, tender.sourceTenderNumber ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => {
        if (sortMode === "TITLE") return left.title.localeCompare(right.title);
        return (left.submissionDeadline ?? "").localeCompare(
          right.submissionDeadline ?? "",
        );
      });
  }, [search, sortMode, statusFilter, tenders]);
  const aiChatHref = assistantHref(organisationId);

  return (
    <div className="workspace-page">
      <header className="workspace-page__header">
        <div>
          <h1>Tenders</h1>
          <p>All tender workspaces for the selected organisation.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" size={18} />
          Add tender
        </Button>
      </header>

      <div
        className="workspace-chip-row workspace-chip-row--left"
        role="tablist"
        aria-label="Tender status groups"
      >
        {(
          [
            ["ALL", `All ${counts.ALL}`],
            ["ACTIVE", `Active ${counts.ACTIVE}`],
            ["NEEDS_ATTENTION", `Needs attention ${counts.NEEDS_ATTENTION}`],
            ["DRAFTS", `Drafts ${counts.DRAFTS}`],
            ["ON_HOLD", `On hold ${counts.ON_HOLD}`],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-pressed={statusFilter === value}
            className={`workspace-chip ${statusFilter === value ? "workspace-chip--active" : ""}`}
            key={value}
            onClick={() => setStatusFilter(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="workspace-toolbar">
        <label className="workspace-search">
          <Search aria-hidden="true" size={16} />
          <Input
            aria-label="Search tenders"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tenders"
            value={search}
          />
        </label>
        <label className="workspace-toolbar__control">
          <SlidersHorizontal aria-hidden="true" size={16} />
          <span className="visually-hidden">Filter tenders</span>
          <Select
            aria-label="Filter tenders"
            onChange={(event) =>
              setStatusFilter(event.target.value as StatusFilter)
            }
            value={statusFilter}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="NEEDS_ATTENTION">Needs attention</option>
            <option value="DRAFTS">Drafts</option>
            <option value="ON_HOLD">On hold</option>
          </Select>
        </label>
        <label className="workspace-toolbar__control">
          <span className="workspace-toolbar__label">Sort</span>
          <Select
            aria-label="Sort tenders"
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            value={sortMode}
          >
            <option value="DEADLINE">Deadline</option>
            <option value="TITLE">Title</option>
          </Select>
        </label>
      </div>

      {message !== "" ? <p aria-live="polite">{message}</p> : null}

      {tenders.length === 0 && message === "" ? (
        <section className="workspace-card">
          <EmptyState
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus aria-hidden="true" size={18} />
                Add tender
              </Button>
            }
            description="Enter details to create a tracking space for this tender."
            title="No tender workspaces yet"
          />
        </section>
      ) : (
        <section className="workspace-card workspace-table-card">
          <div className="workspace-table-scroll" tabIndex={0}>
            <table className="workspace-table">
              <thead>
                <tr>
                  <th scope="col">Tender</th>
                  <th scope="col">Status</th>
                  <th scope="col">Next action</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleTenders.length === 0 ? (
                  <tr>
                    <td className="workspace-table__empty" colSpan={5}>
                      No tenders match the current filters.
                    </td>
                  </tr>
                ) : (
                  visibleTenders.map((tender) => {
                    const presentation = describeTender(tender);
                    return (
                      <tr key={tender.id}>
                        <td>
                          <strong>{tender.title}</strong>
                          <small>{tender.buyer}</small>
                        </td>
                        <td>
                          <span
                            className={`status-badge status-badge--${presentation.tone}`}
                          >
                            {presentation.statusLabel}
                          </span>
                        </td>
                        <td>{presentation.supportingLabel}</td>
                        <td>
                          <strong>
                            {formatDeadlineCountdown(tender.submissionDeadline)}
                          </strong>
                          <small>
                            {formatDeadline(tender.submissionDeadline)}
                          </small>
                        </td>
                        <td>
                          <Link
                            className="button button--secondary workspace-table__action"
                            href={`/tenders/${organisationId}/${tender.id}`}
                          >
                            {presentation.actionLabel}
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {open ? (
        <Modal
          label="Create tender workspace"
          onClose={() => {
            if (!submitting) setOpen(false);
          }}
        >
          <div className="drawer-header">
            <div>
              <span className="eyebrow">Add tender</span>
              <h2>Start new tender</h2>
            </div>
            <IconButton
              disabled={submitting}
              label="Close"
              onClick={() => setOpen(false)}
            >
              <X aria-hidden="true" size={18} />
            </IconButton>
          </div>
          <p>Enter tender details to start tracking.</p>
          <form onSubmit={(event) => void create(event)}>
            <Field label="Tender title" required>
              <Input name="title" required />
            </Field>
            <Field label="Buyer" required>
              <Input name="buyer" required />
            </Field>
            <div className="form-grid">
              <Field label="Tender number, if available">
                <Input name="source_tender_number" />
              </Field>
              <Field label="Category, if supplied">
                <Input name="category" />
              </Field>
              <Field label="Publication date, if supplied">
                <Input name="publication_date" type="date" />
              </Field>
              <Field label="Submission deadline" required>
                <Input
                  name="submission_deadline"
                  required
                  type="datetime-local"
                />
              </Field>
            </div>
            <Field label="Official HTTPS source URL, if supplied">
              <Input name="official_source_url" type="url" />
            </Field>
            <Field label="Description, if supplied">
              <Input name="description" />
            </Field>
            {error !== "" ? <FormMessage>{error}</FormMessage> : null}
            <div className="inline-actions">
              <Button loading={submitting} type="submit">
                {submitting ? "Creating..." : "Add tender"}
              </Button>
              <Button
                disabled={submitting}
                onClick={() => setOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      <Link className="workspace-floating-ai" href={aiChatHref}>
        <span>
          <Sparkles aria-hidden="true" size={16} />
        </span>
        AI Assistant
      </Link>
    </div>
  );
}
