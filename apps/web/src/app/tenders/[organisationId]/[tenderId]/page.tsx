import type { JSX } from "react";
import { TenderWorkspace } from "../../../../components/tender-workspace";
import { AppShell } from "../../../../components/app-shell";

export default async function TenderWorkspacePage({
  params,
}: {
  readonly params: Promise<{ organisationId: string; tenderId: string }>;
}): Promise<JSX.Element> {
  const { organisationId, tenderId } = await params;
  return (
    <AppShell>
      <TenderWorkspace organisationId={organisationId} tenderId={tenderId} />
    </AppShell>
  );
}
