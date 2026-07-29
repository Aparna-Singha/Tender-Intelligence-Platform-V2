import Link from "next/link";
import type { JSX } from "react";

export default function Home(): JSX.Element {
  return (
    <main>
      <h1>Tender Intelligence Platform</h1>
      <p>
        Independent AI-assisted tender intelligence for Indian MSMEs and tender
        teams.
      </p>
      <p>Not affiliated with GeM, CPPP, or any government authority.</p>
      <nav>
        <Link href="/register">Register</Link> ·{" "}
        <Link href="/login">Log in</Link>
      </nav>
    </main>
  );
}
