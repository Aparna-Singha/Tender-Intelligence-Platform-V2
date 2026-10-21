import { parseTenderDateTime } from "./extraction.js";

export interface DeadlineField {
  readonly normalizedTextValue: string | null;
  readonly reviewState: string;
  readonly findingState: string;
  readonly citations: readonly {
    readonly validationStatus: string;
    readonly tenderDocument: {
      readonly role: string;
    };
  }[];
}

export interface DeadlineSelection {
  readonly date: Date | null;
  readonly text: string | null;
  readonly conflicting: boolean;
}

/** Cited corrigenda outrank the primary source; unresolved peer conflicts fail closed. */
export function selectSubmissionDeadline(
  fields: readonly DeadlineField[],
): DeadlineSelection {
  const candidates = fields.flatMap((field) => {
    if (
      (field.reviewState !== "ACCEPTED" &&
        field.reviewState !== "UNREVIEWED") ||
      field.findingState !== "FOUND" ||
      field.normalizedTextValue === null
    )
      return [];
    const date = parseTenderDateTime(field.normalizedTextValue);
    if (date === null) return [];
    return field.citations
      .filter((citation) => citation.validationStatus === "VALID")
      .map((citation) => ({
        date,
        text: field.normalizedTextValue!,
        authority: citation.tenderDocument.role === "CORRIGENDUM" ? 1 : 0,
        reviewed: field.reviewState === "ACCEPTED" ? 1 : 0,
      }));
  });
  if (candidates.length === 0)
    return { date: null, text: null, conflicting: false };
  candidates.sort(
    (a, b) => b.authority - a.authority || b.reviewed - a.reviewed,
  );
  const first = candidates[0]!;
  const peers = candidates.filter(
    (candidate) =>
      candidate.authority === first.authority &&
      candidate.reviewed === first.reviewed,
  );
  if (
    peers.some((candidate) => candidate.date.getTime() !== first.date.getTime())
  )
    return { date: null, text: null, conflicting: true };
  return { date: first.date, text: first.text, conflicting: false };
}
