"use client";

import { Button, Card } from "@tender/ui";
import type { JSX } from "react";

export default function ErrorPage({
  reset,
}: {
  readonly reset: () => void;
}): JSX.Element {
  return (
    <main className="route-state">
      <Card>
        <span className="eyebrow">Recoverable error</span>
        <h1>This page could not be loaded</h1>
        <p>
          No private document content or technical stack details are shown here.
          Try the request again.
        </p>
        <Button onClick={reset}>Try again</Button>
      </Card>
    </main>
  );
}
