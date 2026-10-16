"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { type JSX, type ReactNode } from "react";
import { PageHeader } from "@tender/ui";

export function CompanyWorkspaceHeader({
  actions,
}: {
  readonly actions?: ReactNode;
  readonly organisationId: string;
}): JSX.Element {
  const pathname = usePathname();
  const section = useSearchParams().get("section") ?? "organisation";
  const title = pathname.startsWith("/documents/")
    ? "Company documents"
    : section === "organisation"
      ? "Company profile"
      : section === "preferences"
        ? "Company preferences"
        : section === "people-access"
          ? "People and access"
          : "Settings";
  return <PageHeader actions={actions} title={title} />;
}
