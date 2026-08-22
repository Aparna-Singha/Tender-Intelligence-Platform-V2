import type { JSX } from "react";
import { AppShell } from "../../../components/app-shell";
import { SettingsWorkspace } from "../../../components/settings-workspace";

export default async function SettingsPage({
  params,
}: {
  readonly params: Promise<{ organisationId: string }>;
}): Promise<JSX.Element> {
  const { organisationId } = await params;
  return (
    <AppShell>
      <SettingsWorkspace organisationId={organisationId} />
    </AppShell>
  );
}
