"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type JSX, type ReactNode } from "react";
import { PageHeader } from "@tender/ui";

type CompanyTab = "documents" | "profile";

function currentTab(pathname: string | null): CompanyTab {
  return pathname?.startsWith("/documents/") ? "documents" : "profile";
}

function settingsSection(searchParams: URLSearchParams): string {
  return searchParams.get("section") ?? "organisation";
}

function sectionLabel(section: string): string {
  switch (section) {
    case "people-access":
      return "Access";
    case "preferences":
      return "Preferences";
    case "security":
      return "Settings";
    default:
      return "Profile";
  }
}

export function CompanyWorkspaceHeader({
  actions,
  organisationId,
}: {
  readonly actions?: ReactNode;
  readonly organisationId: string;
}): JSX.Element {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = currentTab(pathname);
  const currentSection = settingsSection(searchParams);

  return (
    <div className="company-workspace-header">
      <PageHeader
        actions={actions}
        description="Company profile, reusable documents, and workspace controls for tender readiness."
        title="Company"
      />
      <div className="company-workspace-header__tabs">
        <nav aria-label="Company" className="company-workspace-tabs">
          <Link
            aria-current={tab === "profile" ? "page" : undefined}
            className={`company-workspace-tabs__link ${tab === "profile" ? "company-workspace-tabs__link--active" : ""}`}
            href={`/settings/${organisationId}`}
          >
            Profile
          </Link>
          <Link
            aria-current={tab === "documents" ? "page" : undefined}
            className={`company-workspace-tabs__link ${tab === "documents" ? "company-workspace-tabs__link--active" : ""}`}
            href={`/documents/${organisationId}`}
          >
            Documents
          </Link>
        </nav>
        <div className="company-workspace-header__context">
          <span>{sectionLabel(currentSection)}</span>
        </div>
      </div>
    </div>
  );
}
