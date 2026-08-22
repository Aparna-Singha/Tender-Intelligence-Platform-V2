"use client";

import {
  ChevronRight,
  CircleHelp,
  FileCheck2,
  Files,
  Home,
  Menu,
  MessageSquare,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { Drawer, IconButton, Select, humanizeEnum } from "@tender/ui";
import { apiRequest } from "../lib/api";
import {
  describeTender,
  formatDeadlineCountdown,
  type TenderSummary,
} from "./tender-presentation";

interface Session {
  readonly active_organisation_id: string | null;
  readonly user: { readonly display_name: string; readonly email: string };
}

interface Membership {
  readonly organisation: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
  };
  readonly role: string;
}

interface ShellNavigationItem {
  readonly href: string | null;
  readonly icon: typeof Home;
  readonly label: string;
}

function matchesPath(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(`${href}/`))
  );
}

function WorkspaceNavItem({
  href,
  icon: Icon,
  label,
  onNavigate,
  pathname,
}: {
  readonly href: string | null;
  readonly icon: typeof Home;
  readonly label: string;
  readonly onNavigate?: () => void;
  readonly pathname: string;
}): JSX.Element {
  if (href === null) {
    return (
      <span
        aria-disabled="true"
        className="workspace-sidebar__nav-link workspace-sidebar__nav-link--disabled"
      >
        <Icon aria-hidden="true" size={16} />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <Link
      className={`workspace-sidebar__nav-link ${matchesPath(pathname, href) ? "workspace-sidebar__nav-link--active" : ""}`}
      href={href}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
    >
      <Icon aria-hidden="true" size={16} />
      <span>{label}</span>
    </Link>
  );
}

function SidebarSection({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}): JSX.Element {
  return (
    <section className="workspace-sidebar__section">
      <h2 className="workspace-sidebar__section-title">{title}</h2>
      {children}
    </section>
  );
}

function QuickAccessLink({
  href,
  meta,
  title,
}: {
  readonly href: string;
  readonly meta: string;
  readonly title: string;
}): JSX.Element {
  return (
    <Link className="workspace-sidebar__quick-link" href={href}>
      <span>{title}</span>
      <small>{meta}</small>
    </Link>
  );
}

function SidebarContents({
  memberships,
  onNavigate,
  onSwitchOrganisation,
  organisationId,
  pathname,
  session,
  tenders,
}: {
  readonly memberships: readonly Membership[];
  readonly onNavigate?: () => void;
  readonly onSwitchOrganisation: (id: string) => void;
  readonly organisationId: string | null;
  readonly pathname: string;
  readonly session: Session | null;
  readonly tenders: readonly TenderSummary[];
}): JSX.Element {
  const organisation = memberships.find(
    ({ organisation: memberOrganisation }) =>
      memberOrganisation.id === organisationId,
  );
  const pathTenderId =
    /^\/tenders\/[^/]+\/([^/?]+)/.exec(pathname)?.[1] ?? null;
  const navItems: readonly ShellNavigationItem[] = [
    { href: "/dashboard", icon: Home, label: "Home" },
    {
      href: organisationId === null ? null : `/tenders/${organisationId}`,
      icon: Files,
      label: "Tenders",
    },
    {
      href: organisationId === null ? null : `/documents/${organisationId}`,
      icon: FileCheck2,
      label: "Company Docs",
    },
  ];
  const recentTenders = [...tenders]
    .sort((left, right) =>
      (left.submissionDeadline ?? "").localeCompare(
        right.submissionDeadline ?? "",
      ),
    )
    .slice(0, 3);
  const recentDrafts = tenders
    .filter((tender) => describeTender(tender).isDraft)
    .slice(0, 2);
  const currentTender = tenders.find((tender) => tender.id === pathTenderId);
  const chatSeed =
    currentTender === undefined
      ? recentTenders
      : [currentTender, ...recentTenders];
  const seen = new Set<string>();
  const chatShortcuts = chatSeed
    .filter((tender) => {
      if (seen.has(tender.id)) return false;
      seen.add(tender.id);
      return true;
    })
    .slice(0, 3);
  const rawInitials = session?.user.display_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const accountInitials = rawInitials === "" ? "TI" : rawInitials;

  return (
    <div className="workspace-sidebar__inner">
      <div className="workspace-sidebar__brand-block">
        <Link
          className="workspace-sidebar__brand"
          href="/dashboard"
          {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        >
          <span className="workspace-sidebar__brand-mark" aria-hidden="true">
            TI
          </span>
          <span>
            Tender Intelligence
            <small>Workspace</small>
          </span>
        </Link>
        <label className="workspace-sidebar__organisation-picker">
          <span>Current organisation</span>
          <Select
            aria-label="Current organisation"
            disabled={memberships.length === 0}
            onChange={(event) => onSwitchOrganisation(event.target.value)}
            value={organisationId ?? ""}
          >
            <option value="">No organisation selected</option>
            {memberships.map(({ organisation: memberOrganisation }) => (
              <option key={memberOrganisation.id} value={memberOrganisation.id}>
                {memberOrganisation.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <nav aria-label="Primary" className="workspace-sidebar__nav">
        {navItems.map((item) => (
          <WorkspaceNavItem
            href={item.href}
            icon={item.icon}
            key={item.label}
            label={item.label}
            pathname={pathname}
            {...(onNavigate === undefined ? {} : { onNavigate })}
          />
        ))}
      </nav>

      <div className="workspace-sidebar__content">
        <SidebarSection title="Recent Tenders">
          {recentTenders.length === 0 ? (
            <p className="workspace-sidebar__empty">
              No tender workspaces yet.
            </p>
          ) : (
            recentTenders.map((tender) => (
              <QuickAccessLink
                href={`/tenders/${organisationId ?? ""}/${tender.id}`}
                key={tender.id}
                meta={formatDeadlineCountdown(tender.submissionDeadline)}
                title={tender.title}
              />
            ))
          )}
        </SidebarSection>

        <SidebarSection title="Recent Drafts">
          {recentDrafts.length === 0 ? (
            <p className="workspace-sidebar__empty">
              Draft work appears here when a tender reaches the drafting flow.
            </p>
          ) : (
            recentDrafts.map((tender) => {
              const presentation = describeTender(tender);
              return (
                <QuickAccessLink
                  href={`/tenders/${organisationId ?? ""}/${tender.id}?stage=draft`}
                  key={tender.id}
                  meta={presentation.supportingLabel}
                  title={tender.title}
                />
              );
            })
          )}
        </SidebarSection>

        <SidebarSection title="Chats">
          {chatShortcuts.length === 0 ? (
            <p className="workspace-sidebar__empty">
              Tender chat stays tender-scoped and appears once a workspace
              exists.
            </p>
          ) : (
            <>
              {chatShortcuts.map((tender, index) => (
                <Link
                  className="workspace-sidebar__chat-link"
                  href={`/tenders/${organisationId ?? ""}/${tender.id}?stage=ask`}
                  key={tender.id}
                  {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
                >
                  <span
                    className={`workspace-sidebar__chat-indicator ${index === 0 ? "workspace-sidebar__chat-indicator--pinned" : ""}`}
                  >
                    <MessageSquare aria-hidden="true" size={12} />
                  </span>
                  <span>
                    {index === 0 ? "Ask tender" : "Tender chat"}
                    <small>{tender.title}</small>
                  </span>
                </Link>
              ))}
              <Link
                className="workspace-sidebar__view-all"
                href={`/tenders/${organisationId ?? ""}`}
                {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
              >
                Browse tender chats{" "}
                <ChevronRight aria-hidden="true" size={12} />
              </Link>
            </>
          )}
        </SidebarSection>

        <div className="workspace-sidebar__footer-links">
          <WorkspaceNavItem
            href={
              organisationId === null ? null : `/settings/${organisationId}`
            }
            icon={Settings}
            label="Settings"
            pathname={pathname}
            {...(onNavigate === undefined ? {} : { onNavigate })}
          />
          <WorkspaceNavItem
            href="/account"
            icon={UserRound}
            label="Account"
            pathname={pathname}
            {...(onNavigate === undefined ? {} : { onNavigate })}
          />
          <span className="workspace-sidebar__nav-link workspace-sidebar__nav-link--disabled">
            <CircleHelp aria-hidden="true" size={16} />
            <span>Help</span>
          </span>
        </div>
      </div>

      <div className="workspace-sidebar__footer">
        <div className="workspace-sidebar__account-card">
          <div className="workspace-sidebar__account-summary">
            <span
              className="workspace-sidebar__account-mark"
              aria-hidden="true"
            >
              {accountInitials}
            </span>
            <div>
              <strong>
                {organisation?.organisation.name ?? "Tender Intelligence"}
              </strong>
              <small>
                {session?.user.display_name ?? "Loading user"}
                {organisation === undefined
                  ? ""
                  : ` · ${humanizeEnum(organisation.role)}`}
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);

  const pathOrganisationId =
    /^\/(?:onboarding|documents|settings|tenders)\/([^/]+)/.exec(
      pathname,
    )?.[1] ?? null;
  const organisationId =
    pathOrganisationId ??
    session?.active_organisation_id ??
    memberships[0]?.organisation.id ??
    null;

  useEffect(() => {
    let active = true;
    const loadShell = (): void => {
      void Promise.all([
        apiRequest<Session>("/auth/session"),
        apiRequest<Membership[]>("/organisations"),
      ])
        .then(async ([nextSession, nextMemberships]) => {
          const nextOrganisationId =
            pathOrganisationId ??
            nextSession.active_organisation_id ??
            nextMemberships[0]?.organisation.id ??
            null;
          const nextTenders =
            nextOrganisationId === null
              ? []
              : await apiRequest<TenderSummary[]>(
                  `/organisations/${nextOrganisationId}/tenders`,
                ).catch(() => []);
          if (!active) return;
          setSession(nextSession);
          setMemberships(nextMemberships);
          setTenders(nextTenders);
        })
        .catch(() => router.replace("/login"));
    };

    loadShell();
    window.addEventListener("organisation-changed", loadShell);
    return () => {
      active = false;
      window.removeEventListener("organisation-changed", loadShell);
    };
  }, [pathOrganisationId, router]);

  const mobileTitle = useMemo(() => {
    if (pathname.startsWith("/tenders/")) return "Tenders";
    if (pathname.startsWith("/documents/")) return "Company Docs";
    if (pathname.startsWith("/settings/")) return "Settings";
    if (pathname.startsWith("/account")) return "Account";
    if (pathname.startsWith("/onboarding/")) return "Settings";
    return "Home";
  }, [pathname]);

  async function switchOrganisation(id: string): Promise<void> {
    await apiRequest(`/organisations/${id}/select`, { method: "POST" });
    window.dispatchEvent(new Event("organisation-changed"));
    setMobileOpen(false);
    router.push("/dashboard");
    router.refresh();
  }

  const sidebar = (
    <SidebarContents
      memberships={memberships}
      onNavigate={() => setMobileOpen(false)}
      onSwitchOrganisation={(id) => void switchOrganisation(id)}
      organisationId={organisationId}
      pathname={pathname}
      session={session}
      tenders={tenders}
    />
  );

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">{sidebar}</aside>
      <div className="workspace-main">
        <header className="workspace-mobilebar">
          <IconButton
            label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" size={18} />
          </IconButton>
          <div>
            <strong>{mobileTitle}</strong>
            <small>{session?.user.display_name ?? "Loading"}</small>
          </div>
        </header>
        <main className="workspace-content">{children}</main>
      </div>
      {mobileOpen ? (
        <Drawer label="Navigation" onClose={() => setMobileOpen(false)}>
          <div className="workspace-drawer__header">
            <strong>Workspace</strong>
            <IconButton
              label="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <X aria-hidden="true" size={18} />
            </IconButton>
          </div>
          {sidebar}
        </Drawer>
      ) : null}
    </div>
  );
}
