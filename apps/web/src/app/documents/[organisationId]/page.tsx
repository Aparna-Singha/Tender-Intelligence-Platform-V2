import type { JSX } from "react";
import { DocumentCentre } from "../../../components/document-centre";
import { AppShell } from "../../../components/app-shell";

export default async function DocumentsPage({
  params,
}: {
  readonly params: Promise<{ organisationId: string }>;
}): Promise<JSX.Element> {
  const { organisationId } = await params;
  return (
    <AppShell>
      <DocumentCentre organisationId={organisationId} />
    </AppShell>
  );
}
