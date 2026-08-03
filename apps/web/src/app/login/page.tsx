import Link from "next/link";
import type { JSX } from "react";
import { AuthForm } from "../../components/auth-form";

export default function LoginPage(): JSX.Element {
  return (
    <main className="auth-layout">
      <section className="auth-context">
        <Link className="brand brand--inverse" href="/">
          <span className="brand__mark" aria-hidden="true">
            TI
          </span>
          <span>
            Tender Intelligence<span>Platform</span>
          </span>
        </Link>
        <div>
          <span className="eyebrow">Welcome back</span>
          <h1>Continue your evidence-led tender review.</h1>
          <p>
            Return to your organisation’s private workspaces, cited findings and
            human-controlled decisions.
          </p>
        </div>
        <p className="auth-context__notice">
          Independent platform. Not affiliated with GeM, CPPP or any government
          authority.
        </p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">Secure account access</span>
          <h2>Log in</h2>
          <p>Use your Tender Intelligence Platform account.</p>
          <AuthForm mode="login" />
          <p className="auth-switch">
            New to the platform? <Link href="/register">Create an account</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
