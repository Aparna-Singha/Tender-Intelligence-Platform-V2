import type { JSX } from "react";
import { TenderCentre } from "../../../components/tender-centre";
import { AppShell } from "../../../components/app-shell";

export default async function TendersPage({
  params,
}: {
  readonly params: Promise<{ organisationId: string }>;
}): Promise<JSX.Element> {
  const { organisationId } = await params;
  return (
    <AppShell>
      <TenderCentre organisationId={organisationId} />
    </AppShell>
  );
}
