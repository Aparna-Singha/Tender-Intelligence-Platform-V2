import type { JSX } from "react";
import { DocumentCentre } from "../../../components/document-centre";

export default async function DocumentsPage({
  params,
}: {
  readonly params: Promise<{ organisationId: string }>;
}): Promise<JSX.Element> {
  const { organisationId } = await params;
  return <DocumentCentre organisationId={organisationId} />;
}
