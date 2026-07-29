import type { JSX } from "react";
import { OnboardingWizard } from "../../../components/onboarding-wizard";

export default async function OnboardingPage({
  params,
}: {
  readonly params: Promise<{ organisationId: string }>;
}): Promise<JSX.Element> {
  const { organisationId } = await params;
  return <OnboardingWizard organisationId={organisationId} />;
}
