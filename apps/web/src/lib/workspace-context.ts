import {
  describeTender,
  formatDeadlineCountdown,
  getDeadlineDays,
  type TenderSummary,
} from "../components/tender-presentation";

export interface WorkspaceDocument {
  readonly id: string;
  readonly displayName: string;
  readonly expiryDate: string | null;
  readonly status: string;
  readonly verificationStatus: string;
}

export interface WorkspaceContext {
  readonly organisationId: string;
  readonly tenders: readonly TenderSummary[] | null;
  readonly documents: readonly WorkspaceDocument[] | null;
  readonly analysedTenderIds?: readonly string[];
  readonly analysisUnavailable?: number;
}

export interface WorkspaceAnswer {
  readonly text: string;
  readonly sources: readonly {
    readonly href: string;
    readonly label: string;
  }[];
}

export function documentReviewReason(
  document: WorkspaceDocument,
  now = Date.now(),
): string | null {
  if (
    document.status === "EXPIRED" ||
    (document.expiryDate !== null &&
      new Date(document.expiryDate).getTime() < now)
  )
    return "Expired";
  if (["FAILED", "REJECTED", "QUARANTINED"].includes(document.status))
    return document.status.toLowerCase();
  if (
    ["HUMAN_REVIEW_REQUIRED", "REJECTED", "UNVERIFIED"].includes(
      document.verificationStatus,
    )
  )
    return "Verification needs review";
  if (
    document.expiryDate !== null &&
    new Date(document.expiryDate).getTime() - now <= 30 * 86_400_000
  )
    return "Expires within 30 days";
  return null;
}

/** Read-only presentation of loaded records. This is not a model or eligibility engine. */
export function answerWorkspaceQuestion(
  prompt: string,
  context: WorkspaceContext,
): WorkspaceAnswer {
  const query = prompt.toLowerCase();
  const tenderHref = `/tenders/${context.organisationId}`;
  const documentsHref = `/documents/${context.organisationId}`;
  const sources: { href: string; label: string }[] = [];
  const navigation =
    /\b(where|navigate|open|go to|how (do|can) i upload)\b/.test(query);
  if (navigation) {
    const documents = /document|file|upload/.test(query);
    return {
      text: documents
        ? "Upload reusable company evidence in Company Docs. Tender source files belong in the relevant tender workspace."
        : "Open the tender workspace to continue analysis, eligibility, drafting, or tender chat.",
      sources: [
        {
          href: documents ? documentsHref : tenderHref,
          label: documents ? "Company Docs" : "Tenders",
        },
      ],
    };
  }
  const wantsDocuments = /document|certificate|company evidence/.test(query);
  const wantsToday = /today|priorit|work on/.test(query);
  const wantsPipeline = /pipeline|summary|summarise|summarize/.test(query);
  const wantsDeadlines = /deadline|due|approaching|overdue/.test(query);
  const wantsAttention = /attention|blocker/.test(query);
  const wantsDraft = query.includes("draft");
  const wantsAnalysed =
    query.includes("analysed") || query.includes("analyzed");
  const wantsActive = query.includes("active tender");
  if (
    !wantsDocuments &&
    !wantsToday &&
    !wantsPipeline &&
    !wantsDeadlines &&
    !wantsAttention &&
    !wantsDraft &&
    !wantsAnalysed &&
    !wantsActive
  )
    return {
      text: "I can report current tender counts, deadlines, attention flags, drafting stages, and company document review needs. I can't safely answer this question from workspace records alone. For source-grounded tender interpretation, open that tender's chat.",
      sources: [],
    };

  const paragraphs: string[] = [];
  if (wantsDocuments || wantsToday) {
    if (context.documents === null)
      paragraphs.push(
        "Company documents could not be loaded. I can't report their review status.",
      );
    else {
      const review = context.documents.flatMap((document) => {
        const reason = documentReviewReason(document);
        return reason === null ? [] : [{ document, reason }];
      });
      paragraphs.push(
        `${review.length} of ${context.documents.length} company documents need review or expiry attention.${review.length === 0 ? "" : "\n" + review.map(({ document, reason }) => `• ${document.displayName} — ${reason}`).join("\n")}`,
      );
      sources.push({ href: documentsHref, label: "Company document records" });
    }
  }
  if (!wantsDocuments || wantsToday || wantsPipeline) {
    if (context.tenders === null)
      paragraphs.push(
        "Tender records could not be loaded. I can't report tender counts or deadlines.",
      );
    else {
      const tenders = context.tenders;
      const withWorkflow = tenders.filter(
        (tender) => tender.workflowState !== undefined,
      );
      const unknown = tenders.length - withWorkflow.length;
      const attention = withWorkflow.filter(
        (tender) => tender.workflowState!.needsAttention,
      );
      const active = withWorkflow.filter(
        (tender) => !tender.workflowState!.isCompleted,
      );
      const approaching = tenders.filter((tender) => {
        const days = getDeadlineDays(tender.submissionDeadline);
        return days !== null && days >= 0 && days <= 14;
      });
      const overdue = tenders.filter((tender) => {
        const days = getDeadlineDays(tender.submissionDeadline);
        return days !== null && days < 0;
      });
      const list = (
        items: readonly TenderSummary[],
        deadline = false,
      ): string =>
        items
          .map((tender) => {
            sources.push({
              href: `${tenderHref}/${tender.id}`,
              label: tender.title,
            });
            return `• ${tender.title} — ${deadline ? formatDeadlineCountdown(tender.submissionDeadline) : describeTender(tender).statusLabel}`;
          })
          .join("\n");
      if (wantsPipeline || wantsActive) {
        paragraphs.push(
          `${tenders.length} tender workspaces; ${active.length} active (not marked complete), including ${withWorkflow.filter((tender) => tender.workflowState!.onHold).length} on hold.${unknown > 0 ? ` Workflow status is unavailable for ${unknown} tender(s).` : ""}`,
        );
        if (wantsPipeline) {
          const groups = new Map<string, number>();
          tenders.forEach((tender) => {
            const label =
              tender.workflowState?.statusLabel ?? "Status unavailable";
            groups.set(label, (groups.get(label) ?? 0) + 1);
          });
          paragraphs.push(
            [...groups]
              .map(([label, count]) => `• ${label}: ${count}`)
              .join("\n"),
          );
        }
        sources.push({ href: tenderHref, label: "Current tender records" });
      }
      if (wantsAnalysed) {
        paragraphs.push(
          context.analysedTenderIds === undefined
            ? "Completed-analysis history is unavailable; a ready source file alone does not prove analysis is complete."
            : `${context.analysedTenderIds.length} tender(s) have a completed extraction run in the available history.${context.analysisUnavailable ? ` Analysis history could not be checked for ${context.analysisUnavailable} tender(s); this count is incomplete.` : ""} This is an analysis-history count, not an eligibility decision.`,
        );
        sources.push({ href: tenderHref, label: "Tender extraction history" });
      }
      if (wantsDeadlines || wantsToday) {
        paragraphs.push(
          `${approaching.length} deadline(s) in the next 14 days.${approaching.length ? "\n" + list(approaching, true) : ""}`,
        );
        paragraphs.push(
          `${overdue.length} overdue tender(s).${overdue.length ? "\n" + list(overdue, true) : ""}`,
        );
        const missing = tenders.filter(
          (tender) => getDeadlineDays(tender.submissionDeadline) === null,
        ).length;
        if (missing)
          paragraphs.push(
            `${missing} tender(s) have no usable deadline; they are excluded from deadline counts.`,
          );
        sources.push({ href: tenderHref, label: "Tender deadlines" });
      }
      if (wantsAttention || wantsToday)
        paragraphs.push(
          `${attention.length} tender(s) are flagged for attention.${attention.length ? "\n" + list(attention) : ""}${unknown ? ` ${unknown} tender(s) have unavailable workflow status.` : ""}`,
        );
      if (wantsDraft) {
        const candidates = withWorkflow.filter(
          (tender) => tender.workflowState!.code === "ANALYSIS_READY",
        );
        paragraphs.push(
          `${candidates.length} tender(s) are at Analysis ready.${candidates.length ? "\n" + list(candidates) : ""}\nOpen Draft to confirm its current prerequisites. These summaries do not establish that generation is permitted.`,
        );
      }
      if (wantsToday)
        paragraphs.unshift(
          "Start with approaching or overdue deadlines, then the recorded attention items below. This ordering uses dates and workflow flags, not an eligibility assessment.",
        );
    }
  }
  return {
    text: paragraphs.join("\n\n"),
    sources: sources.filter(
      (source, index) =>
        sources.findIndex((item) => item.href === source.href) === index,
    ),
  };
}
