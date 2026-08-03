"use client";

import {
  Building2,
  FileCheck2,
  Files,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import {
  Breadcrumbs,
  Button,
  Drawer,
  IconButton,
  Select,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, clearCsrfToken } from "../lib/api";

interface Session {
  active_organisation_id: string | null;
  user: { display_name: string; email: string; id: string };
}
interface Membership {
  organisation: { id: string; name: string; type: string };
  role: string;
}

function ShellNavigation({
  organisationId,
  pathname,
  onNavigate,
}: {
  readonly organisationId: string | null;
  readonly pathname: string;
  readonly onNavigate?: () => void;
}): JSX.Element {
  const items = [
    { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
    {
      href: organisationId === null ? null : `/tenders/${organisationId}`,
      icon: Files,
      label: "Tenders",
    },
    {
      href: organisationId === null ? null : `/documents/${organisationId}`,
      icon: FileCheck2,
      label: "Company evidence",
    },
    {
      href: organisationId === null ? null : `/onboarding/${organisationId}`,
      icon: Building2,
      label: "Organisation profile",
    },
  ] as const;
  return (
    <nav aria-label="Primary" className="shell-nav">
      {items.map(({ href, icon: Icon, label }) =>
        href === null ? (
          <span
            aria-disabled="true"
            className="shell-nav__link shell-nav__link--disabled"
            key={label}
          >
            <Icon aria-hidden="true" size={18} />
            {label}
          </span>
        ) : (
          <Link
            className={`shell-nav__link ${pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)) ? "shell-nav__link--active" : ""}`}
            href={href}
            key={label}
            {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
          >
            <Icon aria-hidden="true" size={18} />
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}

export function AppShell({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  useEffect(() => {
    let active = true;
    const loadShell = (): void => {
      void Promise.all([
        apiRequest<Session>("/auth/session"),
        apiRequest<Membership[]>("/organisations"),
      ])
        .then(([nextSession, nextMemberships]) => {
          if (active) {
            setSession(nextSession);
            setMemberships(nextMemberships);
          }
        })
        .catch(() => router.replace("/login"));
    };
    loadShell();
    window.addEventListener("organisation-changed", loadShell);
    return () => {
      active = false;
      window.removeEventListener("organisation-changed", loadShell);
    };
  }, [router]);
  const pathOrganisationId =
    /^\/(?:onboarding|documents|tenders)\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const organisationId =
    pathOrganisationId ??
    session?.active_organisation_id ??
    memberships[0]?.organisation.id ??
    null;
  const selected = memberships.find(
    ({ organisation }) => organisation.id === organisationId,
  );
  const breadcrumbLabel = pathname.includes("/documents/")
    ? "Company evidence"
    : pathname.includes("/onboarding/")
      ? "Organisation profile"
      : pathname.includes("/tenders/")
        ? "Tenders"
        : "Overview";
  const breadcrumbs = useMemo(
    () => [
      { href: "/dashboard", label: "Workspace" },
      { label: breadcrumbLabel },
    ],
    [breadcrumbLabel],
  );
  async function switchOrganisation(id: string): Promise<void> {
    await apiRequest(`/organisations/${id}/select`, { method: "POST" });
    window.dispatchEvent(new Event("organisation-changed"));
    router.push("/dashboard");
    router.refresh();
  }
  async function logout(): Promise<void> {
    await apiRequest("/auth/logout", { method: "POST" });
    clearCsrfToken();
    router.replace("/login");
  }
  const navigation = (
    <ShellNavigation
      organisationId={organisationId}
      pathname={pathname}
      onNavigate={closeMobile}
    />
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <span className="brand__mark" aria-hidden="true">
            TI
          </span>
          <span>
            Tender Intelligence<span>Platform</span>
          </span>
        </Link>
        <div className="organisation-control">
          <span>Current organisation</span>
          <Select
            aria-label="Current organisation"
            disabled={memberships.length === 0}
            onChange={(event) => void switchOrganisation(event.target.value)}
            value={organisationId ?? ""}
          >
            <option value="">No organisation</option>
            {memberships.map(({ organisation }) => (
              <option key={organisation.id} value={organisation.id}>
                {organisation.name}
              </option>
            ))}
          </Select>
          {selected !== undefined && (
            <small>
              {humanizeEnum(selected.organisation.type)} ·{" "}
              {humanizeEnum(selected.role)}
            </small>
          )}
        </div>
        {navigation}
        <p className="sidebar__notice">
          Independent platform. Not affiliated with GeM, CPPP or any government
          authority.
        </p>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <IconButton
            className="mobile-menu"
            label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" size={20} />
          </IconButton>
          <Breadcrumbs items={breadcrumbs} />
          <details className="account-menu">
            <summary aria-label="Account menu">
              <span>
                {session?.user.display_name.slice(0, 1).toUpperCase() ?? "…"}
              </span>
              <span className="account-menu__name">
                {session?.user.display_name ?? "Loading"}
              </span>
            </summary>
            <div>
              <strong>{session?.user.display_name}</strong>
              <small>{session?.user.email}</small>
              <Button onClick={() => void logout()} variant="quiet">
                <LogOut aria-hidden="true" size={16} />
                Log out
              </Button>
            </div>
          </details>
        </header>
        <main className="content">{children}</main>
      </div>
      {mobileOpen && (
        <Drawer label="Navigation" onClose={closeMobile}>
          <div className="drawer-header">
            <strong>Menu</strong>
            <IconButton label="Close navigation" onClick={closeMobile}>
              <X aria-hidden="true" size={20} />
            </IconButton>
          </div>
          <div className="drawer-brand">Tender Intelligence Platform</div>
          {navigation}
          <p className="sidebar__notice">
            Independent platform. Not affiliated with GeM, CPPP or any
            government authority.
          </p>
        </Drawer>
      )}
    </div>
  );
}
