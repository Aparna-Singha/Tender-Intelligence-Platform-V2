"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type JSX } from "react";
import { Alert, Button, Card } from "@tender/ui";
import { apiRequest, formatApiError } from "../../lib/api";

export default function AcceptInvitationPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const token = searchParams.get("token") ?? "";

  async function accept(): Promise<void> {
    if (busy || token === "") return;
    setBusy(true);
    setStatus("");
    try {
      const result = await apiRequest<{ organisation_id: string }>("/invitations/accept", {
        body: JSON.stringify({ token }),
        method: "POST",
      });
      await apiRequest(`/organisations/${result.organisation_id}/select`, {
        method: "POST",
      });
      router.replace(`/settings/${result.organisation_id}?section=people-access`);
    } catch (caught) {
      setStatus(
        formatApiError(
          caught,
          "This invitation could not be accepted. Sign in with the invited email address and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-context">
        <span className="eyebrow">Invitation</span>
        <h1>Join this organisation workspace</h1>
        <p>
          Invitation acceptance uses the existing authenticated membership flow.
          Tender and company data remain organisation-scoped after you join.
        </p>
      </section>
      <section className="auth-panel">
        <Card className="auth-card">
          <h2>Accept invitation</h2>
          {token === "" ? (
            <Alert tone="warning" title="Invitation token missing">
              <p>Open the full invitation link from your email, then try again.</p>
            </Alert>
          ) : (
            <>
              <p>
                Continue with the invited account. If your session has expired, sign
                in first and reopen this link.
              </p>
              <Button loading={busy} onClick={() => void accept()} type="button">
                Accept invitation
              </Button>
            </>
          )}
          {status !== "" ? (
            <Alert tone="danger" title="Invitation unavailable">
              <p>{status}</p>
            </Alert>
          ) : null}
          <p className="auth-switch">
            Need to authenticate first? <Link href="/login">Go to login</Link>
          </p>
        </Card>
      </section>
    </main>
  );
}
