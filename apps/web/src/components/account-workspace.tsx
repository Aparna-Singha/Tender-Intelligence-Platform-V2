"use client";

import { ContextualAssistant } from "./contextual-assistant";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type JSX } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Table,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, clearCsrfToken, formatApiError } from "../lib/api";
import { assistantHref } from "../lib/assistant";

interface SessionContext {
  readonly active_organisation_id: string | null;
  readonly user: {
    readonly display_name: string;
    readonly email: string;
    readonly id: string;
  };
}

interface Membership {
  readonly organisation: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
  };
  readonly role: string;
}

interface SessionSummary {
  readonly createdAt: string;
  readonly current: boolean;
  readonly expiresAt: string;
  readonly id: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

function formatTimestamp(value: string | null): string {
  if (value === null || value === "") return "Unavailable";
  return new Date(value).toLocaleString();
}

function initials(displayName: string | undefined): string {
  const value = displayName
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return value === undefined || value === "" ? "TI" : value;
}

export function AccountWorkspace(): JSX.Element {
  const router = useRouter();
  const [session, setSession] = useState<SessionContext | null>(null);
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [status, setStatus] = useState("Loading account...");
  const [busy, setBusy] = useState("");
  const [showSessions, setShowSessions] = useState(false);

  async function load(): Promise<void> {
    try {
      const [loadedSession, loadedMemberships, loadedSessions] =
        await Promise.all([
          apiRequest<SessionContext>("/auth/session"),
          apiRequest<readonly Membership[]>("/organisations"),
          apiRequest<readonly SessionSummary[]>("/auth/sessions"),
        ]);
      setSession(loadedSession);
      setMemberships(loadedMemberships);
      setSessions(loadedSessions);
      setStatus("");
    } catch (caught) {
      setStatus(
        formatApiError(caught, "Account details are unavailable right now."),
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const activeMembership = useMemo(
    () =>
      memberships.find(
        ({ organisation }) =>
          organisation.id === session?.active_organisation_id,
      ) ??
      memberships[0] ??
      null,
    [memberships, session?.active_organisation_id],
  );

  const activeSessions = sessions.filter((item) => item.revokedAt === null);
  const otherActiveSessions = activeSessions.filter((item) => !item.current);
  const assistantLink =
    activeMembership === null
      ? null
      : assistantHref(activeMembership.organisation.id);

  async function logout(): Promise<void> {
    setBusy("logout");
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      clearCsrfToken();
      router.replace("/login");
    } finally {
      setBusy("");
    }
  }

  async function revoke(sessionId: string, current: boolean): Promise<void> {
    setBusy(sessionId);
    try {
      await apiRequest(`/auth/sessions/${sessionId}/revoke`, {
        method: "POST",
      });
      if (current) {
        clearCsrfToken();
        router.replace("/login");
        return;
      }
      await load();
    } catch (caught) {
      setStatus(formatApiError(caught, "That session could not be revoked."));
    } finally {
      setBusy("");
    }
  }

  async function revokeOtherSessions(): Promise<void> {
    if (otherActiveSessions.length === 0) return;
    setBusy("revoke-others");
    try {
      for (const item of otherActiveSessions) {
        await apiRequest(`/auth/sessions/${item.id}/revoke`, {
          method: "POST",
        });
      }
      await load();
    } catch (caught) {
      setStatus(
        formatApiError(caught, "Some other sessions could not be revoked."),
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="workspace-page account-page">
      <PageHeader
        description="Personal account and session controls."
        title="Account"
      />

      {status !== "" ? (
        <Alert tone="danger" title="Account unavailable">
          <p>{status}</p>
          <Button onClick={() => void load()} variant="secondary">
            Try again
          </Button>
        </Alert>
      ) : null}

      <div className="account-layout">
        <Card className="account-hero">
          <div className="account-identity">
            <div className="account-identity__summary">
              <span aria-hidden="true" className="account-avatar">
                {initials(session?.user.display_name)}
              </span>
              <div>
                <strong>{session?.user.display_name ?? "Unavailable"}</strong>
                <small>
                  {activeMembership === null
                    ? "No organisation selected"
                    : `${humanizeEnum(activeMembership.role)} \u00b7 ${activeMembership.organisation.name}`}
                </small>
              </div>
            </div>
            <Button disabled type="button" variant="secondary">
              Edit profile
            </Button>
          </div>
        </Card>

        <div className="account-profile-grid">
          <Card className="settings-panel">
            <div className="section-header">
              <div>
                <h2>Personal information</h2>
                <p>Your name, email, and account role.</p>
              </div>
            </div>
            <div className="settings-form-grid">
              <label className="readonly-field">
                <span>Name</span>
                <Input
                  readOnly
                  value={session?.user.display_name ?? "Unavailable"}
                />
              </label>
              <label className="readonly-field">
                <span>Email</span>
                <Input readOnly value={session?.user.email ?? "Unavailable"} />
              </label>
              <label className="readonly-field">
                <span>Role</span>
                <Input
                  readOnly
                  value={
                    activeMembership === null
                      ? "Unavailable"
                      : humanizeEnum(activeMembership.role)
                  }
                />
              </label>
            </div>
            <div className="account-profile-actions">
              <Button disabled type="button">
                Save changes
              </Button>
              <small>
                Personal details are managed by your sign-in provider.
              </small>
            </div>
          </Card>

          <Card className="settings-panel">
            <div className="section-header">
              <div>
                <h2>Security &amp; sessions</h2>
                <p>Manage the active session on this device.</p>
              </div>
            </div>
            <div className="account-session-summary">
              <div className="account-session-summary__row">
                <div>
                  <strong>Active session</strong>
                  <small>Current browser session</small>
                </div>
                <Badge tone="success">Current</Badge>
              </div>
              <div className="account-session-summary__row">
                <div>
                  <strong>Password &amp; security</strong>
                  <small>
                    Manage your password and active sessions using supported
                    account security controls.
                  </small>
                </div>
                <Button
                  onClick={() => setShowSessions(true)}
                  variant="secondary"
                >
                  Manage sessions
                </Button>
              </div>
              <div className="account-session-summary__row">
                <div>
                  <strong>Sign out</strong>
                  <small>Sign out of this browser session.</small>
                </div>
                <Button
                  loading={busy === "logout"}
                  onClick={() => void logout()}
                  variant="secondary"
                >
                  Log out
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {showSessions ? (
        <section
          className="workspace-section account-sessions-panel"
          id="account-sessions"
        >
          <Card className="settings-panel">
            <div className="section-header">
              <div>
                <h2>Sessions</h2>
                <p>
                  Review current and historical sessions, revoke other devices,
                  or log out using the existing authentication flow.
                </p>
              </div>
              <Button
                disabled={otherActiveSessions.length === 0}
                loading={busy === "revoke-others"}
                onClick={() => void revokeOtherSessions()}
                variant="secondary"
              >
                Revoke other sessions
              </Button>
            </div>
            <Table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Created</th>
                  <th>Last seen</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>
                        {item.current ? "Current session" : "Signed-in device"}
                      </strong>
                    </td>
                    <td>{formatTimestamp(item.createdAt)}</td>
                    <td>{formatTimestamp(item.lastSeenAt)}</td>
                    <td>{formatTimestamp(item.expiresAt)}</td>
                    <td>
                      <Badge
                        tone={item.revokedAt === null ? "success" : "neutral"}
                      >
                        {item.revokedAt === null
                          ? item.current
                            ? "Current"
                            : "Active"
                          : "Revoked"}
                      </Badge>
                    </td>
                    <td>
                      {item.revokedAt !== null ? (
                        <span className="settings-table-meta">No action</span>
                      ) : item.current ? (
                        <Button
                          loading={busy === item.id}
                          onClick={() => void logout()}
                          variant="quiet"
                        >
                          Log out
                        </Button>
                      ) : (
                        <Button
                          loading={busy === item.id}
                          onClick={() => void revoke(item.id, false)}
                          variant="quiet"
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </section>
      ) : null}

      {assistantLink === null ? (
        <button className="workspace-floating-ai" disabled type="button">
          <span>
            <Sparkles aria-hidden="true" size={16} />
          </span>
          Ask about my account
        </button>
      ) : (
        <ContextualAssistant
          context="my account"
          organisationId={activeMembership!.organisation.id}
          openInChatHref={assistantLink}
        />
      )}
    </div>
  );
}
