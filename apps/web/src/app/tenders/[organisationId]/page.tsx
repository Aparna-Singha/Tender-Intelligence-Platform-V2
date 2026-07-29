import type { JSX } from "react";
import { TenderCentre } from "../../../components/tender-centre";

export default async function TendersPage({
  params,
}: {
  readonly params: Promise<{ organisationId: string }>;
}): Promise<JSX.Element> {
  const { organisationId } = await params;
  return <TenderCentre organisationId={organisationId} />;
}
