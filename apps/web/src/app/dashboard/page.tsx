import { Dashboard } from "../../components/dashboard";
import type { JSX } from "react";
import { AppShell } from "../../components/app-shell";

export default function DashboardPage(): JSX.Element {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
