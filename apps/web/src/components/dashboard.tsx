"use client";

import { ContextualAssistant } from "./contextual-assistant";

import { Building2, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import {
  Alert,
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
  getDeadlineDays,
  formatDeadlineCountdown,
  type TenderSummary,
} from "./tender-presentation";

interface Session {
  readonly active_organisation_id: string | null;
  readonly user: { readonly display_name: string };
}

interface Membership {
  readonly organisation: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
  };
  readonly role: string;
}

interface DashboardGuidance {
  readonly completeness?: {
    readonly completed: number;
    readonly missingFields: readonly string[];
    readonly percentage: number;
    readonly total: number;
  };
  readonly display_mode?: string;
  readonly progress?: {
    readonly completed_steps: readonly number[];
    readonly current_step: number;
    readonly status: string;
  };
  readonly recommendations: readonly {
    readonly action: string;
    readonly id: string;
    readonly priority: string;
  }[];
}

type HomeFilter = "ALL" | "ACTIVE" | "IN_PROGRESS" | "COMPLETED";

function compareAttention(left: TenderSummary, right: TenderSummary): number {
  return (left.submissionDeadline ?? "").localeCompare(
    right.submissionDeadline ?? "",
  );
}

function greetingName(displayName: string | undefined): string {
  const first = displayName?.trim().split(/\s+/)[0];
  return first === undefined || first === "" ? "there" : first;
}

function deadlineTone(
  submissionDeadline: string | undefined,
): "danger" | "info" | "warning" {
  const days = getDeadlineDays(submissionDeadline);
  if (days === null) return "info";
  if (days < 0 || days <= 3) return "danger";
  if (days <= 7) return "warning";
  return "info";
}

function dashboardSupportingLabel(
  presentation: ReturnType<typeof describeTender>,
): string {
  const labels: Readonly<Record<string, string>> = {
    "analysis ready": "Ready to draft",
    "analysing tender": "Analysis running",
    "checking eligibility": "Eligibility running",
    "checking tender file": "Checking file",
    "draft preparation failed": "Draft issue",
    "extraction failed": "Extraction issue",
    "extraction not started": "Extraction pending",
    "eligibility failed": "Eligibility issue",
    "eligibility not started": "Eligibility pending",
    "needs attention": "Issue detected",
    "needs review": "Review required",
    "preparing draft": "Drafting",
    "ready for review": "Review draft",
    "reading tender": "Reading source",
    "review tender": "Decision required",
    "risk analysis failed": "Risk check failed",
    "risk analysis not started": "Risk check pending",
    "source processing failed": "Processing issue",
    "upload failed": "Upload issue",
    "upload tender": "Source needed",
    "uploading tender": "Uploading",
  };
  const status = presentation.statusLabel
    .replace(/[.…]+$/u, "")
    .trim()
    .toLowerCase();

  return (
    labels[status] ??
    presentation.supportingLabel.split(/\s+/).slice(0, 3).join(" ")
  );
}

export function Dashboard(): JSX.Element {
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [guidance, setGuidance] = useState<DashboardGuidance | null>(null);
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);
  const [filter, setFilter] = useState<HomeFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const loadToken = useRef(0);
  const loadedOrganisationId = useRef<string | null>(null);

  async function load(): Promise<void> {
    const token = ++loadToken.current;
    try {
      const [nextSession, nextMemberships] = await Promise.all([
        apiRequest<Session>("/auth/session"),
        apiRequest<Membership[]>("/organisations"),
      ]);
      const organisationId =
        nextSession.active_organisation_id ??
        nextMemberships[0]?.organisation.id ??
        null;
      if (token !== loadToken.current) return;
      if (loadedOrganisationId.current !== organisationId) {
        loadedOrganisationId.current = organisationId;
        setGuidance(null);
        setTenders([]);
      }
      setSession(nextSession);
      setMemberships(nextMemberships);
      setSelectedId(organisationId);

      if (organisationId === null) {
        setGuidance(null);
        setTenders([]);
      } else {
        const [nextGuidance, nextTenders] = await Promise.all([
          apiRequest<DashboardGuidance>(
            `/organisations/${organisationId}/dashboard-recommendations`,
          ),
          apiRequest<TenderSummary[]>(
            `/organisations/${organisationId}/tenders`,
          ),
        ]);
        if (token !== loadToken.current) return;
        setGuidance(nextGuidance);
        setTenders(nextTenders);
      }

      setError("");
    } catch (caught) {
      if (token !== loadToken.current) return;
      setError(
        formatApiError(
          caught,
          "Unable to load your workspace. Please try again.",
        ),
      );
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const reload = (): void => {
      void load();
    };
    window.addEventListener("organisation-changed", reload);
    return () => {
      loadToken.current += 1;
      window.removeEventListener("organisation-changed", reload);
    };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (creating) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    setCreateError("");
    try {
      await apiRequest("/organisations", {
        body: JSON.stringify({
          name: data.get("name"),
          type: data.get("type"),
        }),
        method: "POST",
      });
      form.reset();
      window.dispatchEvent(new Event("organisation-changed"));
      await load();
      setCreateOpen(false);
      setCreating(false);
    } catch (caught) {
      setCreateError(
        formatApiError(caught, "The organisation could not be created."),
      );
      setCreating(false);
    }
  }

  const selectedOrganisation = memberships.find(
    ({ organisation }) => organisation.id === selectedId,
  );
  const tenderModels = useMemo(
    () =>
      tenders.map((tender) => ({
        presentation: describeTender(tender),
        tender,
      })),
    [tenders],
  );
  const allAttentionRows = useMemo(() => {
    const recommendationRows = (guidance?.recommendations ?? []).map(
      (recommendation) => ({
        actionLabel: "Review",
        deadline: "Organisation profile",
        issue: recommendation.action,
        key: recommendation.id,
        tenderName:
          selectedOrganisation?.organisation.name ?? "Organisation profile",
        tone:
          recommendation.priority === "HIGH"
            ? "danger"
            : recommendation.priority === "MEDIUM"
              ? "warning"
              : "info",
        href: selectedId === null ? "/dashboard" : `/settings/${selectedId}`,
      }),
    );
    const tenderAttention = tenderModels
      .filter(({ presentation }) => presentation.needsAttention)
      .sort((left, right) => compareAttention(left.tender, right.tender))
      .map(({ presentation, tender }) => ({
        actionLabel: presentation.actionLabel,
        deadline: formatDeadlineCountdown(tender.submissionDeadline),
        issue: presentation.supportingLabel,
        key: tender.id,
        tenderName: tender.title,
        tone: deadlineTone(tender.submissionDeadline),
        href: `/tenders/${selectedId ?? ""}/${tender.id}?stage=overview`,
      }));
    return [...tenderAttention, ...recommendationRows];
  }, [guidance, selectedId, selectedOrganisation, tenderModels]);
  const attentionRows = allAttentionRows.slice(0, 3);
  const inProgressRows = tenderModels.filter(
    ({ presentation }) => presentation.isInProgress,
  );
  const upcomingDeadlineCount = tenderModels.filter(({ tender }) => {
    const days = getDeadlineDays(tender.submissionDeadline);
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const companyProfileProgress = guidance?.progress;
  const companyCompleteness = guidance?.completeness;
  const companyReminder =
    companyProfileProgress === undefined &&
    companyCompleteness === undefined &&
    (guidance?.recommendations.length ?? 0) === 0
      ? null
      : {
          detail:
            guidance?.recommendations[0]?.action ??
            (companyProfileProgress !== undefined
              ? `${companyProfileProgress.completed_steps.length} of 8 profile steps are complete.`
              : companyCompleteness !== undefined
                ? `${companyCompleteness.completed} of ${companyCompleteness.total} known company fields are complete.`
                : "Review company readiness before continuing tender work."),
          href: selectedId === null ? "/dashboard" : `/settings/${selectedId}`,
          label:
            companyProfileProgress?.status === "COMPLETED"
              ? "Company profile ready"
              : "Company readiness",
        };
  const counts = {
    ACTIVE: tenderModels.filter(({ presentation }) => !presentation.isCompleted)
      .length,
    ALL: tenderModels.length,
    COMPLETED: tenderModels.filter(
      ({ presentation }) => presentation.isCompleted,
    ).length,
    IN_PROGRESS: inProgressRows.length,
  };
  const visibleTenders = tenderModels.filter(({ presentation }) => {
    if (filter === "ACTIVE") return !presentation.isCompleted;
    if (filter === "COMPLETED") return presentation.isCompleted;
    if (filter === "IN_PROGRESS") return presentation.isInProgress;
    return true;
  });
  const aiChatHref = selectedId === null ? null : assistantHref(selectedId);

  if (loading) {
    return (
      <div className="workspace-page">
        <header className="workspace-page__header">
          <div>
            <h1>Home</h1>
            <p>Loading your organisation workspace and tender queue.</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="workspace-page dashboard-page">
      <header className="workspace-page__header">
        <div>
          <h1>Good morning, {greetingName(session?.user.display_name)}</h1>
          <p>Here&apos;s what needs your attention today.</p>
        </div>
        {selectedId === null ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" size={18} />
            Create organisation
          </Button>
        ) : (
          <Link
            aria-label="Add tender"
            className="button button--primary workspace-cta"
            href={`/tenders/${selectedId}`}
          >
            <Plus aria-hidden="true" size={18} />
            Analyse new tender
          </Link>
        )}
      </header>

      {error !== "" ? (
        <Alert tone="danger" title="Workspace unavailable">
          <p>{error}</p>
          <Button onClick={() => void load()} variant="secondary">
            Try again
          </Button>
        </Alert>
      ) : null}

      {memberships.length === 0 ? (
        <section className="workspace-card">
          <EmptyState
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Building2 aria-hidden="true" size={18} />
                Create organisation
              </Button>
            }
            description="An organisation is the private boundary for company evidence, tender workspaces, roles, and permissions."
            title="Create your first organisation workspace"
          />
        </section>
      ) : (
        <>
          <section
            aria-hidden="true"
            className="workspace-section dashboard-secondary-summary"
          >
            <div className="tender-summary-grid">
              <div className="tender-summary-card">
                <span className="tender-summary-card__label">
                  Active tenders
                </span>
                <strong>{counts.ACTIVE}</strong>
                <p>Tenders you are currently tracking.</p>
              </div>
              <div className="tender-summary-card">
                <span className="tender-summary-card__label">
                  Need attention
                </span>
                <strong>{allAttentionRows.length}</strong>
                <p>Items currently surfacing the next important review.</p>
              </div>
              <div className="tender-summary-card">
                <span className="tender-summary-card__label">
                  Upcoming deadlines
                </span>
                <strong>{upcomingDeadlineCount}</strong>
                <p>Deadlines inside the next 7 days.</p>
              </div>
            </div>
          </section>

          {companyReminder === null ? null : (
            <section
              aria-hidden="true"
              className="workspace-section dashboard-company-reminder"
            >
              <div className="workspace-card workspace-card--compact">
                <div className="workspace-row workspace-row--plain">
                  <div className="workspace-row__title">
                    <strong>{companyReminder.label}</strong>
                    <p>{companyReminder.detail}</p>
                  </div>
                  <span className="workspace-row__deadline" />
                  <Link
                    className="button button--secondary"
                    href={companyReminder.href}
                  >
                    Review company
                  </Link>
                </div>
              </div>
            </section>
          )}

          <section className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h2>Needs your attention</h2>
              </div>
            </div>
            <div className="workspace-card">
              {attentionRows.length === 0 ? (
                <div className="workspace-empty-row">
                  <p>No urgent work is waiting right now.</p>
                </div>
              ) : (
                <ul className="attention-list">
                  {attentionRows.map((row) => (
                    <li className="attention-row" key={row.key}>
                      <span
                        aria-hidden="true"
                        className={`status-dot status-dot--${row.tone}`}
                      />
                      <div className="attention-row__main">
                        <strong>{row.tenderName}</strong>
                        <p>{row.issue}</p>
                      </div>
                      <span
                        className={`deadline-text deadline-text--${row.tone}`}
                      >
                        {row.deadline}
                      </span>
                      <Link
                        className="button button--secondary"
                        href={row.href}
                      >
                        {row.actionLabel}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="workspace-section">
            <div className="workspace-section__header workspace-section__header--stacked">
              <div>
                <h2>Your tenders</h2>
              </div>
              <div
                className="workspace-chip-row workspace-chip-row--left dashboard-filter-row"
                role="tablist"
                aria-label="Tender filters"
              >
                {(
                  [
                    ["ALL", `All ${counts.ALL}`],
                    ["ACTIVE", `Active ${counts.ACTIVE}`],
                    ["IN_PROGRESS", `In progress ${counts.IN_PROGRESS}`],
                    ["COMPLETED", `Completed ${counts.COMPLETED}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    aria-pressed={filter === value}
                    className={`workspace-chip ${filter === value ? "workspace-chip--active" : ""}`}
                    key={value}
                    onClick={() => setFilter(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="workspace-card">
              {visibleTenders.length === 0 ? (
                <div className="workspace-empty-row">
                  <p>No tenders match this view yet.</p>
                </div>
              ) : (
                <div className="workspace-rows">
                  {visibleTenders.map(({ presentation, tender }) => (
                    <article className="workspace-row" key={tender.id}>
                      <div className="workspace-row__title">
                        <strong>{tender.title}</strong>
                      </div>
                      <span
                        className={`status-badge status-badge--${presentation.tone}`}
                      >
                        {presentation.statusLabel}
                      </span>
                      <span className="workspace-row__supporting">
                        {dashboardSupportingLabel(presentation)}
                      </span>
                      <span className="workspace-row__deadline">
                        {formatDeadlineCountdown(tender.submissionDeadline)}
                      </span>
                      <Link
                        className="button button--secondary"
                        href={`/tenders/${selectedId ?? ""}/${tender.id}?stage=overview`}
                      >
                        {presentation.actionLabel}
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {inProgressRows.length > 0 ? (
            <section className="workspace-section dashboard-in-progress">
              <div className="workspace-section__header">
                <div>
                  <h2>In progress</h2>
                </div>
              </div>
              <div className="workspace-progress-grid">
                {inProgressRows.map(({ presentation, tender }) => {
                  const progress = tender.workspace?.processingProgress ?? 0;
                  const progressPrefix = presentation.isDraft
                    ? "Drafting"
                    : "Analysing";
                  return (
                    <Link
                      className="workspace-card progress-card"
                      href={`/tenders/${selectedId ?? ""}/${tender.id}?stage=overview`}
                      key={tender.id}
                    >
                      <div className="progress-card__header">
                        <strong>
                          {progressPrefix}: {tender.title}
                        </strong>
                        <span>{progress}%</span>
                      </div>
                      <div
                        aria-label={`${progress}% complete`}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={progress}
                        className="progress-bar"
                        role="progressbar"
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}

      {aiChatHref === null ? (
        <button className="workspace-floating-ai" disabled type="button">
          <span>
            <Sparkles aria-hidden="true" size={16} />
          </span>
          AI Assistant
        </button>
      ) : (
        <>
          <Link className="visually-hidden" href={aiChatHref}>
            AI Assistant
          </Link>
          <ContextualAssistant
            context="my workspace"
            organisationId={selectedId!}
            openInChatHref={aiChatHref}
          />
        </>
      )}

      {createOpen ? (
        <Modal
          label="Create organisation"
          onClose={() => {
            if (!creating) setCreateOpen(false);
          }}
        >
          <div className="drawer-header">
            <div>
              <span className="eyebrow">Private workspace</span>
              <h2>Create organisation</h2>
            </div>
            <IconButton
              disabled={creating}
              label="Close"
              onClick={() => setCreateOpen(false)}
            >
              <X aria-hidden="true" size={18} />
            </IconButton>
          </div>
          <p>
            Organisation membership controls access to company evidence and
            tender work.
          </p>
          <form onSubmit={(event) => void create(event)}>
            <Field label="Organisation name" required>
              <Input autoFocus maxLength={160} name="name" required />
            </Field>
            <Field
              hint="MSME is for your company's tender work. Consultant is for tender professionals managing client workspaces."
              label="Organisation type"
              required
            >
              <Select name="type">
                <option value="MSME">MSME</option>
                <option value="CONSULTANT">Consultant</option>
              </Select>
            </Field>
            {createError !== "" ? (
              <FormMessage>{createError}</FormMessage>
            ) : null}
            <div className="inline-actions">
              <Button loading={creating} type="submit">
                {creating ? "Creating..." : "Create organisation"}
              </Button>
              <Button
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
