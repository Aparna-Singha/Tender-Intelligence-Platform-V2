import { Card, Skeleton } from "@tender/ui";
import type { JSX } from "react";

export default function Loading(): JSX.Element {
  return (
    <main className="route-state" aria-label="Loading page" aria-live="polite">
      <Card>
        <Skeleton className="skeleton--heading" />
        <Skeleton />
        <Skeleton />
        <span className="visually-hidden">Loading…</span>
      </Card>
    </main>
  );
}
