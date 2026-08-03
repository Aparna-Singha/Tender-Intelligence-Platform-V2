import { Card } from "@tender/ui";
import Link from "next/link";
import type { JSX } from "react";

export default function NotFound(): JSX.Element {
  return (
    <main className="route-state">
      <Card>
        <span className="eyebrow">Not found</span>
        <h1>This page is unavailable</h1>
        <p>
          It may have moved, or your organisation may not have access to it.
        </p>
        <Link className="button button--primary" href="/dashboard">
          Return to overview
        </Link>
      </Card>
    </main>
  );
}
