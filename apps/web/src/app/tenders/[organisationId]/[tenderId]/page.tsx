import type { JSX } from "react";
import { TenderWorkspace } from "../../../../components/tender-workspace";

export default async function TenderWorkspacePage({
  params,
}: {
  readonly params: Promise<{ organisationId: string; tenderId: string }>;
}): Promise<JSX.Element> {
  const { organisationId, tenderId } = await params;
  return (
    <TenderWorkspace organisationId={organisationId} tenderId={tenderId} />
  );
}
