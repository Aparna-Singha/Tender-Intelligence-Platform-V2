import type { JSX } from "react";
import { AppShell } from "../../components/app-shell";
import { AccountWorkspace } from "../../components/account-workspace";

export default function AccountPage(): JSX.Element {
  return (
    <AppShell>
      <AccountWorkspace />
    </AppShell>
  );
}
