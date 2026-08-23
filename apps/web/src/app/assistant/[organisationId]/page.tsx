import type { JSX } from "react";
import { AppShell } from "../../../components/app-shell";
import { AssistantWorkspace } from "../../../components/assistant-workspace";

export default async function AssistantPage({
  params,
}: {
  readonly params: Promise<{ readonly organisationId: string }>;
}): Promise<JSX.Element> {
  const { organisationId } = await params;

  return (
    <AppShell>
      <AssistantWorkspace organisationId={organisationId} />
    </AppShell>
  );
}
