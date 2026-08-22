"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  FormMessage,
  Input,
  PageHeader,
  Select,
  Table,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";

type SettingsSection =
  "organisation" | "people-access" | "security" | "preferences";

interface OrganisationDetails {
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

interface Membership {
  readonly organisation: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
  };
  readonly role: string;
}

interface MemberRecord {
  readonly createdAt: string;
  readonly id: string;
  readonly role: string;
  readonly user: {
    readonly displayName: string;
    readonly email: string;
  };
}

interface SessionContext {
  readonly active_organisation_id: string | null;
  readonly user: {
    readonly display_name: string;
    readonly email: string;
    readonly id: string;
  };
}

interface SessionSummary {
  readonly createdAt: string;
  readonly current: boolean;
  readonly expiresAt: string;
  readonly id: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

interface ResumeResponse {
  readonly display_mode: "BEGINNER" | "PROFESSIONAL";
  readonly progress: {
    readonly completed_steps: readonly number[];
    readonly current_step: number;
    readonly status: string;
  };
  readonly values: Record<string, unknown>;
}

const sectionLabels: Readonly<Record<SettingsSection, string>> = {
  organisation: "Organisation",
  "people-access": "People & access",
  security: "Security",
  preferences: "Preferences",
};

const ownerInviteRoles = [
  "ADMIN",
  "TENDER_EXECUTIVE",
  "CONSULTANT",
  "REVIEWER",
] as const;
const adminInviteRoles = [
  "TENDER_EXECUTIVE",
  "CONSULTANT",
  "REVIEWER",
] as const;
const ownerChangeRoles = [
  "ADMIN",
  "TENDER_EXECUTIVE",
  "CONSULTANT",
  "REVIEWER",
] as const;

function formatTimestamp(value: string | null): string {
  if (value === null || value === "") return "Unavailable";
  return new Date(value).toLocaleString();
}

function arrayValue(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return "Not provided";
}

function listValue(value: unknown): string {
  const entries = arrayValue(value);
  return entries.length === 0
    ? "Not provided"
    : entries.map(humanizeEnum).join(", ");
}

export function SettingsWorkspace({
  organisationId,
}: {
  readonly organisationId: string;
}): JSX.Element {
  const searchParams = useSearchParams();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("organisation");
  const [organisation, setOrganisation] = useState<OrganisationDetails | null>(
    null,
  );
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [members, setMembers] = useState<readonly MemberRecord[]>([]);
  const [session, setSession] = useState<SessionContext | null>(null);
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [profile, setProfile] = useState<ResumeResponse | null>(null);
  const [status, setStatus] = useState("Loading settings...");
  const [inviteMessage, setInviteMessage] = useState("");
  const [roleMessage, setRoleMessage] = useState("");
  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState("");

  async function load(): Promise<void> {
    try {
      const [
        loadedOrganisation,
        loadedMemberships,
        loadedMembers,
        loadedSession,
        loadedSessions,
        loadedProfile,
      ] = await Promise.all([
        apiRequest<OrganisationDetails>(`/organisations/${organisationId}`),
        apiRequest<readonly Membership[]>("/organisations"),
        apiRequest<readonly MemberRecord[]>(
          `/organisations/${organisationId}/members`,
        ),
        apiRequest<SessionContext>("/auth/session"),
        apiRequest<readonly SessionSummary[]>("/auth/sessions"),
        apiRequest<ResumeResponse>(
          `/organisations/${organisationId}/onboarding`,
        ),
      ]);
      setOrganisation(loadedOrganisation);
      setMemberships(loadedMemberships);
      setMembers(loadedMembers);
      setSession(loadedSession);
      setSessions(loadedSessions);
      setProfile(loadedProfile);
      setStatus("");
    } catch (caught) {
      setStatus(formatApiError(caught, "Settings are unavailable right now."));
    }
  }

  useEffect(() => {
    void load();
  }, [organisationId]);

  useEffect(() => {
    const section = searchParams.get("section");
    if (
      section === "organisation" ||
      section === "people-access" ||
      section === "security" ||
      section === "preferences"
    ) {
      setActiveSection(section);
    }
  }, [searchParams]);

  const currentMembership = memberships.find(
    ({ organisation: currentOrganisation }) =>
      currentOrganisation.id === organisationId,
  );
  const currentRole = currentMembership?.role ?? "";
  const inviteableRoles =
    currentRole === "OWNER"
      ? ownerInviteRoles
      : currentRole === "ADMIN"
        ? adminInviteRoles
        : [];
  const activeSessions = sessions.filter((item) => item.revokedAt === null);
  const revokedSessions = sessions.length - activeSessions.length;
  const otherSessions = activeSessions.filter((item) => !item.current);

  const preferenceSummary = useMemo(
    () => [
      ["Buyer types", listValue(profile?.values.buyer_types)],
      ["Preferred states", listValue(profile?.values.preferred_states)],
      [
        "Minimum preparation days",
        textValue(profile?.values.minimum_preparation_days),
      ],
      [
        "Summary language",
        humanizeEnum(textValue(profile?.values.summary_language)),
      ],
      [
        "Notification preferences",
        listValue(profile?.values.notification_preferences),
      ],
      ["Workflow reviewers", listValue(profile?.values.reviews_roles)],
    ],
    [profile?.values],
  );

  async function invite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inviting) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = values.get("email");
    const role = values.get("role");
    if (typeof email !== "string" || typeof role !== "string") return;
    setInviting(true);
    setInviteMessage("");
    try {
      await apiRequest(`/organisations/${organisationId}/invitations`, {
        body: JSON.stringify({ email, role }),
        method: "POST",
      });
      form.reset();
      setInviteMessage(
        "Invitation sent if delivery is configured for this environment.",
      );
    } catch (caught) {
      setInviteMessage(
        formatApiError(caught, "The invitation could not be sent."),
      );
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(membershipId: string): Promise<void> {
    const nextRole = pendingRoles[membershipId];
    if (typeof nextRole !== "string" || nextRole === "") return;
    setUpdatingRoleId(membershipId);
    setRoleMessage("");
    try {
      await apiRequest(
        `/organisations/${organisationId}/members/${membershipId}/role`,
        {
          body: JSON.stringify({ role: nextRole }),
          method: "PATCH",
        },
      );
      setRoleMessage("Membership role updated.");
      setPendingRoles((current) => {
        const next = { ...current };
        delete next[membershipId];
        return next;
      });
      await load();
    } catch (caught) {
      setRoleMessage(formatApiError(caught, "The role could not be updated."));
    } finally {
      setUpdatingRoleId("");
    }
  }

  return (
    <div className="workspace-page settings-page">
      <PageHeader
        description="Manage the organisation workspace configuration."
        title="Settings"
      />

      <div className="settings-layout">
        <aside className="workspace-card settings-rail">
          <nav aria-label="Settings sections" className="settings-rail__nav">
            {(Object.keys(sectionLabels) as readonly SettingsSection[]).map(
              (section) => (
                <button
                  className={`settings-rail__link ${activeSection === section ? "settings-rail__link--active" : ""}`}
                  key={section}
                  onClick={() => setActiveSection(section)}
                  type="button"
                >
                  <span>{sectionLabels[section]}</span>
                  {section === "people-access" && members.length > 0 ? (
                    <small>{members.length} member(s)</small>
                  ) : section === "security" ? (
                    <small>{activeSessions.length} active session(s)</small>
                  ) : section === "organisation" && profile !== null ? (
                    <small>
                      {profile.progress.completed_steps.length}/8 profile steps
                      complete
                    </small>
                  ) : section === "preferences" && profile !== null ? (
                    <small>{humanizeEnum(profile.display_mode)}</small>
                  ) : null}
                </button>
              ),
            )}
          </nav>
        </aside>

        <div className="settings-content">
          {status !== "" ? (
            <Alert tone="danger" title="Settings unavailable">
              <p>{status}</p>
              <Button onClick={() => void load()} variant="secondary">
                Try again
              </Button>
            </Alert>
          ) : null}

          {activeSection === "organisation" && organisation !== null ? (
            <section className="workspace-section">
              <Card className="settings-panel">
                <div className="section-header">
                  <div>
                    <h2>Organisation</h2>
                    <p>
                      Existing editable company information and access controls
                      remain preserved through the current structured profile
                      flow.
                    </p>
                  </div>
                  <button
                    className="button button--secondary"
                    onClick={() => setActiveSection("people-access")}
                    type="button"
                  >
                    People &amp; access
                  </button>
                </div>
                <div className="settings-form-grid">
                  <label className="readonly-field">
                    <span>Organisation name</span>
                    <Input readOnly value={organisation.name} />
                  </label>
                  <label className="readonly-field">
                    <span>Organisation type</span>
                    <Input readOnly value={humanizeEnum(organisation.type)} />
                  </label>
                  <label className="readonly-field">
                    <span>Registered location</span>
                    <Input
                      readOnly
                      value={textValue(profile?.values.registered_location)}
                    />
                  </label>
                  <label className="readonly-field">
                    <span>Website</span>
                    <Input
                      readOnly
                      value={textValue(profile?.values.website)}
                    />
                  </label>
                  <label className="readonly-field">
                    <span>Business models</span>
                    <Input
                      readOnly
                      value={listValue(profile?.values.business_models)}
                    />
                  </label>
                  <label className="readonly-field">
                    <span>Years of experience</span>
                    <Input
                      readOnly
                      value={textValue(profile?.values.years_experience)}
                    />
                  </label>
                </div>
                <div className="settings-note">
                  Profile progress:{" "}
                  {profile === null
                    ? "Unavailable"
                    : `${profile.progress.completed_steps.length} of 8 steps complete`}
                  . Direct field editing is handled in the existing organisation
                  profile flow.
                </div>
                <div className="inline-actions">
                  <Link
                    className="button button--secondary"
                    href={`/onboarding/${organisationId}`}
                  >
                    Open organisation profile
                  </Link>
                </div>
                <p className="settings-field-hint">
                  Organisation created {formatTimestamp(organisation.createdAt)}
                  . Current role:{" "}
                  {currentRole === ""
                    ? "Unavailable"
                    : humanizeEnum(currentRole)}
                  .
                </p>
              </Card>
            </section>
          ) : null}

          {activeSection === "people-access" ? (
            <section className="workspace-section">
              <Card className="settings-panel">
                <div className="section-header">
                  <div>
                    <h2>People &amp; access</h2>
                    <p>
                      Real organisation membership, invitation, and role
                      controls only. Member removal and custom permissions are
                      not supported by the current backend.
                    </p>
                  </div>
                </div>

                {inviteableRoles.length === 0 ? (
                  <Alert tone="info" title="Invitation controls unavailable">
                    <p>
                      Only owner and admin roles can send invitations. Role
                      changes are limited to owners and never allow assigning
                      owner through this UI.
                    </p>
                  </Alert>
                ) : (
                  <form
                    className="settings-invite-form"
                    onSubmit={(event) => void invite(event)}
                  >
                    <Field label="Invite teammate by email" required>
                      <Input
                        name="email"
                        placeholder="person@company.com"
                        required
                        type="email"
                      />
                    </Field>
                    <Field label="Role" required>
                      <Select
                        defaultValue={inviteableRoles[0]}
                        name="role"
                        required
                      >
                        {inviteableRoles.map((role) => (
                          <option key={role} value={role}>
                            {humanizeEnum(role)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button loading={inviting} type="submit">
                      Send invitation
                    </Button>
                  </form>
                )}
                {inviteMessage !== "" ? (
                  <FormMessage
                    tone={inviteMessage.includes("sent") ? "success" : "error"}
                  >
                    {inviteMessage}
                  </FormMessage>
                ) : null}
              </Card>

              <Card className="settings-panel">
                <div className="section-header">
                  <div>
                    <h2>Current members</h2>
                    <p>
                      Roles reflect current organisation membership only.
                      Invitation acceptance is handled through the signed
                      invitation link.
                    </p>
                  </div>
                </div>
                <Table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Current role</th>
                      <th>Joined</th>
                      <th>Role update</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => {
                      const canChange =
                        currentRole === "OWNER" &&
                        session?.user.id !== undefined &&
                        member.user.email !== session.user.email;
                      const selectedRole =
                        pendingRoles[member.id] ?? member.role;
                      return (
                        <tr key={member.id}>
                          <td>
                            <strong>{member.user.displayName}</strong>
                            <div className="settings-table-meta">
                              {member.user.email}
                            </div>
                          </td>
                          <td>
                            <Badge
                              tone={
                                member.role === "OWNER" ? "success" : "info"
                              }
                            >
                              {humanizeEnum(member.role)}
                            </Badge>
                          </td>
                          <td>{formatTimestamp(member.createdAt)}</td>
                          <td>
                            {canChange ? (
                              <div className="settings-role-editor">
                                <Select
                                  onChange={(event) =>
                                    setPendingRoles((current) => ({
                                      ...current,
                                      [member.id]: event.target.value,
                                    }))
                                  }
                                  value={selectedRole}
                                >
                                  {ownerChangeRoles.map((role) => (
                                    <option key={role} value={role}>
                                      {humanizeEnum(role)}
                                    </option>
                                  ))}
                                </Select>
                                <Button
                                  disabled={selectedRole === member.role}
                                  loading={updatingRoleId === member.id}
                                  onClick={() => void changeRole(member.id)}
                                  type="button"
                                  variant="secondary"
                                >
                                  Update
                                </Button>
                              </div>
                            ) : (
                              <span className="settings-table-meta">
                                {member.role === "OWNER"
                                  ? "Owner role is fixed here."
                                  : "Role changes require owner authority."}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {roleMessage !== "" ? (
                  <FormMessage
                    tone={roleMessage.includes("updated") ? "success" : "error"}
                  >
                    {roleMessage}
                  </FormMessage>
                ) : null}
              </Card>
            </section>
          ) : null}

          {activeSection === "security" ? (
            <section className="workspace-section">
              <div className="settings-summary-grid">
                <Card className="tender-summary-card">
                  <span className="tender-summary-card__label">
                    Active sessions
                  </span>
                  <strong>{activeSessions.length}</strong>
                  <p>Authenticated sessions for the signed-in user.</p>
                </Card>
                <Card className="tender-summary-card">
                  <span className="tender-summary-card__label">
                    Other devices
                  </span>
                  <strong>{otherSessions.length}</strong>
                  <p>Revocation is supported, but only at the account level.</p>
                </Card>
                <Card className="tender-summary-card">
                  <span className="tender-summary-card__label">
                    Revoked history
                  </span>
                  <strong>{revokedSessions}</strong>
                  <p>
                    Historical sessions remain visible for the current user.
                  </p>
                </Card>
              </div>

              <Card className="settings-panel">
                <div className="section-header">
                  <div>
                    <h2>Security controls</h2>
                    <p>
                      Organisation-wide MFA, SSO, IP allowlists, and password
                      policy controls are not available in the current product
                      contract.
                    </p>
                  </div>
                  <Link className="button button--secondary" href="/account">
                    Open account security
                  </Link>
                </div>
                <Table>
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Created</th>
                      <th>Last seen</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.slice(0, 4).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>
                            {item.current
                              ? "Current session"
                              : "Account session"}
                          </strong>
                          <div className="settings-table-meta">{item.id}</div>
                        </td>
                        <td>{formatTimestamp(item.createdAt)}</td>
                        <td>{formatTimestamp(item.lastSeenAt)}</td>
                        <td>
                          <Badge
                            tone={
                              item.revokedAt === null ? "success" : "neutral"
                            }
                          >
                            {item.revokedAt === null
                              ? item.current
                                ? "Current"
                                : "Active"
                              : "Revoked"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </section>
          ) : null}

          {activeSection === "preferences" ? (
            <section className="workspace-section">
              <Card className="settings-panel">
                <div className="section-header">
                  <div>
                    <h2>Saved preferences</h2>
                    <p>
                      These values are sourced from the current organisation
                      profile and workflow preference steps.
                    </p>
                  </div>
                  <Link
                    className="button button--secondary"
                    href={`/onboarding/${organisationId}`}
                  >
                    Edit preferences
                  </Link>
                </div>
                <dl className="detail-list">
                  {preferenceSummary.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </section>
          ) : null}
        </div>
      </div>

      <button
        className="workspace-floating-ai"
        disabled
        title="A workspace-wide assistant isn't available yet. Open a tender's AI Chat for grounded, tender-scoped answers."
        type="button"
      >
        <span>
          <Sparkles aria-hidden="true" size={16} />
        </span>
        Ask about settings
      </button>
    </div>
  );
}
