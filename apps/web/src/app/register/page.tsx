import Link from "next/link";
import type { JSX } from "react";
import { AuthForm } from "../../components/auth-form";

export default function RegisterPage(): JSX.Element {
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
          <span className="eyebrow">Start with a private workspace</span>
          <h1>Make tender complexity easier to review.</h1>
          <p>
            Organise source documents, preserve citations and keep eligibility
            and pursuit decisions with your team.
          </p>
        </div>
        <p className="auth-context__notice">
          The platform does not guarantee eligibility, compliance, submission or
          bid success.
        </p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">Create your account</span>
          <h2>Get started</h2>
          <p>You will create or join an organisation after registration.</p>
          <AuthForm mode="register" />
          <p className="auth-switch">
            Already have an account? <Link href="/login">Log in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
