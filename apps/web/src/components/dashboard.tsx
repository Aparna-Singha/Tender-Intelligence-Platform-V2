"use client";
import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { X } from "lucide-react";
import {
  Alert,
  Button,
  Field,
  FormMessage,
  IconButton,
  Input,
  Modal,
  Select,
} from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { assistantHref } from "../lib/assistant";
import type { TenderSummary } from "./tender-presentation";
import { ContextualAssistant } from "./contextual-assistant";
import { DashboardView } from "./zai/dashboard-view";
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

export function Dashboard(): JSX.Element {
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [guidance, setGuidance] = useState<DashboardGuidance | null>(null);
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);
  const [filter, setFilter] = useState<
    "ALL" | "ACTIVE" | "IN_PROGRESS" | "COMPLETED"
  >("ALL");
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
    if (
      new URLSearchParams(window.location.search).get("create") ===
      "organisation"
    )
      setCreateOpen(true);
    void load();
    const reload = (): void => {
      setLoading(true);
      setSession(null);
      setMemberships([]);
      setSelectedId(null);
      setGuidance(null);
      setTenders([]);
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
  if (loading)
    return (
      <div role="status" className="space-y-6">
        <h1 className="text-3xl font-bold">Home</h1>
        <p>Loading your organisation workspace and tender queue.</p>
        <div className="h-32 rounded-2xl animate-shimmer" />
      </div>
    );
  if (error)
    return (
      <Alert tone="danger" title="Workspace unavailable">
        <p>{error}</p>
        <Button onClick={() => void load()} variant="secondary">
          Try again
        </Button>
      </Alert>
    );
  return (
    <div className="zai-workspace">
      <DashboardView
        tenders={tenders}
        userName={session?.user.display_name ?? "there"}
        organisationName={
          selectedOrganisation?.organisation.name ?? "Your workspace"
        }
        organisationId={selectedId}
        recommendations={guidance?.recommendations ?? []}
        companyProgress={guidance?.completeness?.percentage ?? null}
        onCreate={() => setCreateOpen(true)}
        filter={filter}
        onFilter={setFilter}
      />
      {selectedId && (
        <ContextualAssistant
          context="my workspace"
          organisationId={selectedId}
          openInChatHref={assistantHref(selectedId)}
        />
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
