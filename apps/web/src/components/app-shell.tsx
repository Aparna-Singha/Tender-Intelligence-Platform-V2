"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { Alert, Button, humanizeEnum } from "@tender/ui";
import {
  apiRequest,
  clearCsrfToken,
  formatApiError,
  PublicApiError,
} from "../lib/api";
import { assistantHref } from "../lib/assistant";
import { describeTender, type TenderSummary } from "./tender-presentation";
import { ShellView } from "./zai/shell-view";
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
export function AppShell({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);
  const [tendersOrganisationId, setTendersOrganisationId] = useState<
    string | null
  >(null);
  const [shellLoadError, setShellLoadError] = useState<
    "recoverable" | "forbidden" | null
  >(null);
  const [retryKey, setRetryKey] = useState(0);

  const pathOrganisationId =
    /^\/(?:assistant|onboarding|documents|settings|tenders)\/([^/]+)/.exec(
      pathname,
    )?.[1] ?? null;
  const organisationId =
    pathOrganisationId ??
    session?.active_organisation_id ??
    memberships[0]?.organisation.id ??
    null;

  useEffect(() => {
    let active = true;
    let latestLoad = 0;
    const loadShell = (retryStale = true): void => {
      const token = ++latestLoad;
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
                );
          if (!active || token !== latestLoad) return;
          setSession(nextSession);
          setMemberships(nextMemberships);
          setTenders(nextTenders);
          setTendersOrganisationId(nextOrganisationId);
          setShellLoadError(null);
        })
        .catch((error: unknown) => {
          if (!active || token !== latestLoad) return;
          if (error instanceof PublicApiError) {
            if (error.status === 401 || error.status === 403) {
              setSession(null);
              setMemberships([]);
              setTenders([]);
              setTendersOrganisationId(null);
              if (error.status === 401) {
                setShellLoadError(null);
                router.replace("/login");
              } else setShellLoadError("forbidden");
              return;
            }
            if (
              retryStale &&
              error.status === 0 &&
              error.code === "STALE_RESPONSE"
            ) {
              loadShell(false);
              return;
            }
          }
          setShellLoadError("recoverable");
        });
    };

    loadShell();
    const organisationChanged = (): void => {
      setShellLoadError(null);
      setSession(null);
      setMemberships([]);
      setTenders([]);
      setTendersOrganisationId(null);
      loadShell();
    };
    window.addEventListener("organisation-changed", organisationChanged);
    return () => {
      active = false;
      latestLoad += 1;
      window.removeEventListener("organisation-changed", organisationChanged);
    };
  }, [pathOrganisationId, retryKey, router]);

  const mobileTitle = useMemo(() => {
    if (pathname.startsWith("/assistant/")) return "AI Chat";
    if (pathname.startsWith("/tenders/")) return "Tenders";
    if (
      pathname.startsWith("/documents/") ||
      pathname.startsWith("/onboarding/")
    )
      return "Company Docs";
    if (pathname.startsWith("/settings/")) return "Settings";
    if (pathname.startsWith("/account")) return "Account";
    return "Home";
  }, [pathname, searchParams]);

  async function switchOrganisation(id: string): Promise<void> {
    if (busy || !memberships.some((member) => member.organisation.id === id))
      return;
    setBusy(true);
    setActionError("");
    try {
      await apiRequest(`/organisations/${id}/select`, { method: "POST" });
      window.dispatchEvent(new Event("organisation-changed"));
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setActionError(formatApiError(error, "Unable to switch organisation."));
    } finally {
      setBusy(false);
    }
  }
  async function logout(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      clearCsrfToken();
      setSession(null);
      setMemberships([]);
      setTenders([]);
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setActionError(
        formatApiError(error, "Unable to sign out. Please try again."),
      );
      setBusy(false);
    }
  }
  const hrefFor = (page: string): string | null => {
    if (page === "dashboard") return "/dashboard";
    if (page === "account") return "/account";
    if (page === "help") return "/#faq";
    if (page === "add-organisation") return "/dashboard?create=organisation";
    if (organisationId === null) return null;
    if (page.startsWith("tender:")) {
      const [, id, stage] = page.split(":");
      return `/tenders/${organisationId}/${id}?stage=${stage}`;
    }
    if (page === "onboarding") return `/onboarding/${organisationId}`;
    if (page === "company-docs") return `/documents/${organisationId}`;
    if (page === "ai-chat") return assistantHref(organisationId);
    if (page === "settings")
      return `/settings/${organisationId}?section=organisation`;
    return `/tenders/${organisationId}`;
  };
  return (
    <ShellView
      data={{
        page:
          mobileTitle === "Home"
            ? "dashboard"
            : mobileTitle === "Company Docs"
              ? "company-docs"
              : mobileTitle === "AI Chat"
                ? "ai-chat"
                : mobileTitle.toLowerCase(),
        activeStage: searchParams.get("stage"),
        pathname,
        activeOrgId: organisationId,
        activeTenderId:
          /^\/tenders\/[^/]+\/([^/?]+)/.exec(pathname)?.[1] ?? null,
        organizations: memberships.map(({ organisation, role }) => ({
          id: organisation.id,
          name: organisation.name,
          role: humanizeEnum(role),
          initials: organisation.name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join(""),
          color: "#FF5722",
        })),
        tenders:
          tendersOrganisationId === organisationId
            ? tenders.map((tender) => ({
                ...tender,
                isDraft: describeTender(tender).isDraft,
              }))
            : [],
        userName: session?.user.display_name ?? "Loading user",
        userEmail: session?.user.email ?? "",
        busy,
        setPage: (page) => {
          const href = hrefFor(page);
          if (href) router.push(href);
        },
        hrefFor,
        setActiveOrg: (id) => void switchOrganisation(id),
        openTender: (id) => {
          if (organisationId)
            router.push(`/tenders/${organisationId}/${id}?stage=overview`);
        },
        signOut: () => void logout(),
      }}
    >
      {actionError && (
        <Alert title="Account action failed" tone="danger">
          {actionError}
        </Alert>
      )}
      {shellLoadError === "recoverable" && (
        <Alert title="Workspace navigation unavailable" tone="danger">
          <p>Navigation could not be loaded. Please try again.</p>
          <Button
            onClick={() => {
              setShellLoadError(null);
              setRetryKey((key) => key + 1);
            }}
            type="button"
            variant="secondary"
          >
            Try loading workspace again
          </Button>
        </Alert>
      )}
      {shellLoadError === "forbidden" && (
        <Alert title="Workspace access denied" tone="danger">
          <p>You do not have permission to load this workspace.</p>
        </Alert>
      )}
      {children}
    </ShellView>
  );
}
