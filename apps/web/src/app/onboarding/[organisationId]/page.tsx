import type { JSX } from "react";
import { OnboardingWizard } from "../../../components/onboarding-wizard";
import { AppShell } from "../../../components/app-shell";

export default async function OnboardingPage({
  params,
}: {
  readonly params: Promise<{ organisationId: string }>;
}): Promise<JSX.Element> {
  const { organisationId } = await params;
  return (
    <AppShell>
      <OnboardingWizard organisationId={organisationId} />
    </AppShell>
  );
}
