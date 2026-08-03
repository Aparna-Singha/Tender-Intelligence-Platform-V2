import {
  ArrowRight,
  CheckCircle2,
  FileSearch,
  LockKeyhole,
  Scale,
} from "lucide-react";
import Link from "next/link";
import type { JSX } from "react";

export default function Home(): JSX.Element {
  return (
    <div className="landing">
      <header className="public-nav">
        <Link className="brand" href="/">
          <span className="brand__mark" aria-hidden="true">
            TI
          </span>
          <span>
            Tender Intelligence<span>Platform</span>
          </span>
        </Link>
        <nav aria-label="Account">
          <Link className="button button--quiet" href="/login">
            Log in
          </Link>
          <Link className="button button--primary" href="/register">
            Create account
          </Link>
        </nav>
      </header>
      <main className="landing-main">
        <section className="hero">
          <span className="eyebrow">Evidence-led tender work</span>
          <h1>
            Turn complex tender documents into clear, reviewable next actions.
          </h1>
          <p>
            Tender Intelligence Platform helps Indian MSMEs, tender teams and
            consultants review cited requirements, compare private company
            evidence and keep important decisions in human hands.
          </p>
          <div className="hero__actions">
            <Link
              className="button button--primary button--large"
              href="/register"
            >
              Create account <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link
              className="button button--secondary button--large"
              href="/login"
            >
              Log in
            </Link>
          </div>
          <p className="hero__note">
            No automated submission. No guarantee of eligibility, compliance or
            bid success.
          </p>
        </section>
        <section aria-labelledby="how-heading" className="steps">
          <div className="section-intro">
            <span className="eyebrow">A focused workflow</span>
            <h2 id="how-heading">
              From source documents to accountable action
            </h2>
          </div>
          <ol>
            <li>
              <span>1</span>
              <div>
                <h3>Upload tender documents</h3>
                <p>
                  Keep tender sources and corrigenda organised in a private
                  workspace.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>Review cited requirements and risks</h3>
                <p>
                  Trace important findings back to the document, page and source
                  excerpt.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>Compare evidence and plan next actions</h3>
                <p>
                  Separate machine proposals from human conclusions and
                  unresolved work.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section aria-labelledby="trust-heading" className="trust">
          <div className="section-intro">
            <span className="eyebrow">Built for responsible review</span>
            <h2 id="trust-heading">Trust comes from visible boundaries</h2>
          </div>
          <div className="trust-grid">
            <article>
              <FileSearch aria-hidden="true" />
              <h3>Source-linked findings</h3>
              <p>
                Important tender findings retain bounded citations for human
                checking.
              </p>
            </article>
            <article>
              <LockKeyhole aria-hidden="true" />
              <h3>Organisation-private evidence</h3>
              <p>
                Company files remain private and access is enforced by
                organisation permissions.
              </p>
            </article>
            <article>
              <Scale aria-hidden="true" />
              <h3>Human-controlled decisions</h3>
              <p>
                Pursuit, evidence review and draft approval remain explicit
                human actions.
              </p>
            </article>
          </div>
        </section>
        <section className="independence">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <strong>Independent by design</strong>
            <p>
              Not affiliated with Government e-Marketplace (GeM), CPPP, any
              ministry or any government authority.
            </p>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <span>Tender Intelligence Platform</span>
        <span>Independent tender analysis and bid-readiness support.</span>
        <span>Human review is required for high-stakes decisions.</span>
      </footer>
    </div>
  );
}
