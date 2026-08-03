"use client";

import { ArrowRight, Building2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type JSX } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";

interface Session {
  active_organisation_id: string | null;
}
interface Membership {
  organisation: { id: string; name: string; type: string };
  role: string;
}
interface DashboardGuidance {
  completeness: {
    completed: number;
    missingFields: readonly string[];
    percentage: number;
    total: number;
  };
  display_mode: "BEGINNER" | "PROFESSIONAL";
  progress: {
    completed_steps: readonly number[];
    current_step: number;
    status: string;
  };
  recommendations: readonly { action: string; id: string; priority: string }[];
}
interface DocumentSummary {
  id: string;
  status: string;
  verificationStatus: string;
}
interface TenderSummary {
  buyer: string;
  id: string;
  isDemonstration: boolean;
  lifecycleStatus: string;
  sourceTenderNumber: string | null;
  submissionDeadline: string;
  title: string;
  workspace: { processingProgress: number; status: string } | null;
}

export function Dashboard(): JSX.Element {
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<DashboardGuidance | null>(null);
  const [documents, setDocuments] = useState<readonly DocumentSummary[]>([]);
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  async function load(): Promise<void> {
    try {
      const [session, nextMemberships] = await Promise.all([
        apiRequest<Session>("/auth/session"),
        apiRequest<Membership[]>("/organisations"),
      ]);
      const id =
        session.active_organisation_id ??
        nextMemberships[0]?.organisation.id ??
        null;
      setMemberships(nextMemberships);
      setSelectedId(id);
      if (id !== null) {
        const [nextGuidance, nextDocuments, nextTenders] = await Promise.all([
          apiRequest<DashboardGuidance>(
            `/organisations/${id}/dashboard-recommendations`,
          ),
          apiRequest<DocumentSummary[]>(`/organisations/${id}/documents`),
          apiRequest<TenderSummary[]>(`/organisations/${id}/tenders`),
        ]);
        setGuidance(nextGuidance);
        setDocuments(nextDocuments);
        setTenders(nextTenders);
      }
      setError("");
    } catch (caught) {
      setError(
        formatApiError(
          caught,
          "Unable to load your workspace. Please try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
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
      await load();
      window.dispatchEvent(new Event("organisation-changed"));
      setCreateOpen(false);
      setCreating(false);
    } catch (caught) {
      setCreateError(
        formatApiError(caught, "The organisation could not be created."),
      );
      setCreating(false);
    }
  }
  const selected = memberships.find(
    ({ organisation }) => organisation.id === selectedId,
  )?.organisation;
  const readyDocuments = documents.filter(
    ({ status }) => status === "READY",
  ).length;
  if (loading)
    return (
      <div className="page">
        <PageHeader
          description="Loading your organisation context and supported workflow data."
          title="Overview"
        />
        <div className="summary-grid">
          <StatCard title="Organisation profile" value="Loading…" />
          <StatCard title="Company evidence" value="Loading…" />
          <StatCard title="Tender workspaces" value="Loading…" />
        </div>
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        actions={
          memberships.length === 0 ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" size={18} />
              Create organisation
            </Button>
          ) : (
            <Link
              className="button button--primary"
              href={`/tenders/${selectedId ?? ""}`}
            >
              Create tender workspace
            </Link>
          )
        }
        description={
          selected === undefined
            ? "Create an organisation workspace to keep tender work, company evidence and permissions properly separated."
            : `You are working in ${selected.name}. Review current work and choose the next human action.`
        }
        eyebrow="Tender command centre"
        title={selected === undefined ? "Set up your workspace" : "Overview"}
      />
      {error !== "" && (
        <Alert tone="danger" title="Workspace unavailable">
          <p>{error}</p>
          <Button onClick={() => void load()} variant="secondary">
            Try again
          </Button>
        </Alert>
      )}
      {memberships.length === 0 ? (
        <Card>
          <EmptyState
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Building2 aria-hidden="true" size={18} />
                Create organisation
              </Button>
            }
            description="An organisation is the private boundary for company evidence, tender workspaces, members and permissions. Choose MSME for your own company’s bidding work, or Consultant when managing tender work for client organisations."
            title="Create your first organisation workspace"
          />
        </Card>
      ) : (
        <>
          <div className="summary-grid">
            <StatCard
              description={`${guidance?.progress.completed_steps.length ?? 0} of 8 onboarding steps saved`}
              title="Organisation profile"
              value={`${guidance?.completeness.percentage ?? 0}% complete`}
            />
            <StatCard
              description="Ready means processed, not verified or eligible"
              title="Company evidence"
              value={`${readyDocuments} ready · ${documents.length} total`}
            />
            <StatCard
              description={
                tenders.some(
                  ({ workspace }) => workspace?.status === "INGESTING",
                )
                  ? "Source processing is active"
                  : "Organisation-scoped workspaces"
              }
              title="Tender workspaces"
              value={String(tenders.length)}
            />
          </div>
          <div className="two-column">
            <Card>
              <div className="section-header">
                <div>
                  <h2>Continue working</h2>
                  <p>Your most recently created tender workspaces.</p>
                </div>
                <Link href={`/tenders/${selectedId ?? ""}`}>View all</Link>
              </div>
              {tenders.length === 0 ? (
                <EmptyState
                  action={
                    <Link
                      className="button button--secondary"
                      href={`/tenders/${selectedId ?? ""}`}
                    >
                      Create tender workspace
                    </Link>
                  }
                  description="Add tender metadata and upload private source documents when you are ready."
                  title="No tender workspaces yet"
                />
              ) : (
                <div className="stack">
                  {tenders.slice(0, 4).map((tender) => (
                    <article key={tender.id}>
                      <div className="section-header">
                        <div>
                          <h3>{tender.title}</h3>
                          <p>
                            {tender.buyer}
                            {tender.sourceTenderNumber === null
                              ? ""
                              : ` · ${tender.sourceTenderNumber}`}
                          </p>
                        </div>
                        <Badge
                          tone={
                            tender.lifecycleStatus === "READY"
                              ? "success"
                              : "info"
                          }
                        >
                          {humanizeEnum(tender.lifecycleStatus)}
                        </Badge>
                      </div>
                      {tender.isDemonstration && (
                        <Badge tone="warning">Demonstration tender</Badge>
                      )}
                      <div className="inline-actions">
                        <Link
                          href={`/tenders/${selectedId ?? ""}/${tender.id}`}
                        >
                          Open workspace{" "}
                          <ArrowRight aria-hidden="true" size={14} />
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <div className="section-header">
                <div>
                  <h2>Next actions</h2>
                  <p>
                    Suggestions derived from the saved organisation profile.
                  </p>
                </div>
              </div>
              {guidance?.recommendations.length === 0 ? (
                <p>No profile recommendations are currently available.</p>
              ) : (
                <div className="stack">
                  {guidance?.recommendations.map((recommendation) => (
                    <div className="recommendation" key={recommendation.id}>
                      <Badge
                        tone={
                          recommendation.priority === "HIGH"
                            ? "warning"
                            : "info"
                        }
                      >
                        {humanizeEnum(recommendation.priority)} priority
                      </Badge>
                      <p>{recommendation.action}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="inline-actions">
                <Link href={`/onboarding/${selectedId ?? ""}`}>
                  Review organisation profile
                </Link>
                <Link href={`/documents/${selectedId ?? ""}`}>
                  Open company evidence
                </Link>
              </div>
            </Card>
          </div>
        </>
      )}
      {createOpen && (
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
              hint="MSME is for your company’s tender work. Consultant is for tender professionals managing client workspaces."
              label="Organisation type"
              required
            >
              <Select name="type">
                <option value="MSME">MSME</option>
                <option value="CONSULTANT">Consultant</option>
              </Select>
            </Field>
            {createError !== "" && <FormMessage>{createError}</FormMessage>}
            <div className="inline-actions">
              <Button loading={creating} type="submit">
                {creating ? "Creating…" : "Create organisation"}
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
      )}
    </div>
  );
}
