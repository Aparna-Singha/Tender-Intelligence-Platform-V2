"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type JSX } from "react";
import { apiRequest } from "../lib/api";

interface TenderSummary {
  buyer: string;
  id: string;
  isDemonstration: boolean;
  lifecycleStatus: string;
  submissionDeadline: string;
  title: string;
  workspace: { processingProgress: number; status: string };
}

interface CreatedTender {
  tender_id: string;
  version_id: string;
}

function optionalText(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function TenderCentre({
  organisationId,
}: {
  readonly organisationId: string;
}): JSX.Element {
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);
  const [message, setMessage] = useState("Loading tender workspaces…");

  async function load(): Promise<void> {
    try {
      setTenders(await apiRequest(`/organisations/${organisationId}/tenders`));
      setMessage("");
    } catch {
      setMessage("Unable to load tender workspaces.");
    }
  }

  useEffect(() => {
    void load();
  }, [organisationId]);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const deadline = values.get("submission_deadline");
    const sourceTenderNumber = values.get("source_tender_number");
    if (typeof deadline !== "string") return;
    try {
      const created = await apiRequest<CreatedTender>(
        `/organisations/${organisationId}/tenders`,
        {
          body: JSON.stringify({
            buyer: values.get("buyer"),
            category: optionalText(values.get("category")),
            description: optionalText(values.get("description")),
            official_source_url: optionalText(
              values.get("official_source_url"),
            ),
            publication_date: optionalText(values.get("publication_date")),
            source_tender_number:
              typeof sourceTenderNumber === "string" &&
              sourceTenderNumber.length > 0
                ? sourceTenderNumber
                : undefined,
            submission_deadline: new Date(deadline).toISOString(),
            title: values.get("title"),
          }),
          method: "POST",
        },
      );
      form.reset();
      window.location.assign(`/tenders/${organisationId}/${created.tender_id}`);
    } catch {
      setMessage("Tender workspace could not be created.");
    }
  }

  return (
    <main>
      <div className="panel">
        <Link href="/dashboard">Back to dashboard</Link>
        <h1>Manual tender ingestion</h1>
        <p>
          Create an organisation-private workspace, then attach the official
          tender source and annexures. This phase does not analyse tender
          contents.
        </p>
        <form onSubmit={(event) => void create(event)}>
          <h2>Create tender workspace</h2>
          <label>
            Tender title
            <input name="title" required />
          </label>
          <label>
            Buyer
            <input name="buyer" required />
          </label>
          <label>
            Tender number, if available
            <input name="source_tender_number" />
          </label>
          <label>
            Publication date, if supplied
            <input name="publication_date" type="date" />
          </label>
          <label>
            Submission deadline
            <input name="submission_deadline" required type="datetime-local" />
          </label>
          <label>
            Category, if supplied
            <input name="category" />
          </label>
          <label>
            Official HTTPS source URL, if supplied
            <input name="official_source_url" type="url" />
          </label>
          <label>
            Description, if supplied
            <textarea name="description" />
          </label>
          <p>Source type: manual upload</p>
          <button type="submit">Create private workspace</button>
        </form>
        <p aria-live="polite">{message}</p>
        {tenders.map((tender) => (
          <article key={tender.id}>
            <h2>{tender.title}</h2>
            {tender.isDemonstration && (
              <p className="warning">
                Demonstration tender — not live procurement information.
              </p>
            )}
            <p>
              {tender.buyer} · {tender.lifecycleStatus} ·{" "}
              {tender.workspace.processingProgress}%
            </p>
            <Link href={`/tenders/${organisationId}/${tender.id}`}>
              Open workspace
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
