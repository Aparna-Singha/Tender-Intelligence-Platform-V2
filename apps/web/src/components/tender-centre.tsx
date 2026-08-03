"use client";

import { ArrowRight, Files, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type JSX } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Progress,
  Textarea,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";

interface TenderSummary {
  buyer: string;
  id: string;
  isDemonstration: boolean;
  lifecycleStatus: string;
  sourceTenderNumber: string | null;
  submissionDeadline: string;
  title: string;
  workspace: { processingProgress: number; status: string } | null;
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
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  async function load(): Promise<void> {
    try {
      setTenders(await apiRequest(`/organisations/${organisationId}/tenders`));
      setMessage("");
    } catch (caught) {
      setMessage(formatApiError(caught, "Unable to load tender workspaces."));
    }
  }
  useEffect(() => {
    void load();
  }, [organisationId]);
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const deadline = values.get("submission_deadline");
    if (typeof deadline !== "string") return;
    setSubmitting(true);
    setError("");
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
            source_tender_number: optionalText(
              values.get("source_tender_number"),
            ),
            submission_deadline: new Date(deadline).toISOString(),
            title: values.get("title"),
          }),
          method: "POST",
        },
      );
      form.reset();
      window.location.assign(`/tenders/${organisationId}/${created.tender_id}`);
    } catch (caught) {
      setError(
        formatApiError(caught, "Tender workspace could not be created."),
      );
      setSubmitting(false);
    }
  }
  return (
    <div className="page">
      <PageHeader
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" size={18} />
            Create tender workspace
          </Button>
        }
        description="Create organisation-private workspaces, then add official tender documents and annexures through the secure upload flow."
        eyebrow="Tender centre"
        title="Tenders"
      />
      {message !== "" && <p aria-live="polite">{message}</p>}
      {tenders.length === 0 && message === "" ? (
        <Card>
          <EmptyState
            action={
              <Button onClick={() => setOpen(true)}>
                <Files aria-hidden="true" size={18} />
                Create tender workspace
              </Button>
            }
            description="Start with tender metadata. An official source URL is recorded only as metadata and is never scraped."
            title="No tender workspaces yet"
          />
        </Card>
      ) : (
        <div className="stack">
          {tenders.map((tender) => (
            <Card key={tender.id}>
              <div className="section-header">
                <div>
                  <div className="inline-actions">
                    <Badge
                      tone={
                        tender.lifecycleStatus === "READY" ? "success" : "info"
                      }
                    >
                      {humanizeEnum(tender.lifecycleStatus)}
                    </Badge>
                    {tender.isDemonstration && (
                      <Badge tone="warning">Demonstration tender</Badge>
                    )}
                  </div>
                  <h2>{tender.title}</h2>
                  <p>
                    {tender.buyer}
                    {tender.sourceTenderNumber === null
                      ? ""
                      : ` · ${tender.sourceTenderNumber}`}
                  </p>
                </div>
                <Link
                  className="button button--secondary"
                  href={`/tenders/${organisationId}/${tender.id}`}
                >
                  Open workspace <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </div>
              <div className="tender-meta">
                <span>
                  Deadline{" "}
                  <strong>
                    {new Date(tender.submissionDeadline).toLocaleString()}
                  </strong>
                </span>
                <Progress
                  label={humanizeEnum(
                    tender.workspace?.status ?? tender.lifecycleStatus,
                  )}
                  value={tender.workspace?.processingProgress ?? 0}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
      {open && (
        <Modal
          label="Create tender workspace"
          onClose={() => {
            if (!submitting) setOpen(false);
          }}
        >
          <div className="drawer-header">
            <div>
              <span className="eyebrow">Manual ingestion</span>
              <h2>Create tender workspace</h2>
            </div>
            <IconButton
              disabled={submitting}
              label="Close"
              onClick={() => setOpen(false)}
            >
              <X aria-hidden="true" size={18} />
            </IconButton>
          </div>
          <p>
            Enter only known tender metadata. You will securely upload source
            documents after creation.
          </p>
          <form onSubmit={(event) => void create(event)}>
            <Field label="Tender title" required>
              <Input name="title" required />
            </Field>
            <Field label="Buyer" required>
              <Input name="buyer" required />
            </Field>
            <div className="form-grid">
              <Field label="Tender number, if available">
                <Input name="source_tender_number" />
              </Field>
              <Field label="Category, if supplied">
                <Input name="category" />
              </Field>
              <Field label="Publication date, if supplied">
                <Input name="publication_date" type="date" />
              </Field>
              <Field label="Submission deadline" required>
                <Input
                  name="submission_deadline"
                  required
                  type="datetime-local"
                />
              </Field>
            </div>
            <Field
              hint="Stored as metadata only. The platform does not scrape this URL."
              label="Official HTTPS source URL, if supplied"
            >
              <Input name="official_source_url" type="url" />
            </Field>
            <Field label="Description, if supplied">
              <Textarea name="description" />
            </Field>
            <p className="disclaimer">
              Source type: manual upload. This action does not fetch or analyse
              any source URL.
            </p>
            {error !== "" && <FormMessage>{error}</FormMessage>}
            <div className="inline-actions">
              <Button loading={submitting} type="submit">
                {submitting ? "Creating…" : "Create private workspace"}
              </Button>
              <Button
                disabled={submitting}
                onClick={() => setOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
