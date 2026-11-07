"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DashboardView } from "./zai/dashboard-view";
import { ShellView, type ShellData } from "./zai/shell-view";
import {
  EvidenceMatrix,
  type AssessmentRun,
  type MatrixResult,
} from "./evidence-matrix";
import { RequirementEvidence, type Attachment } from "./requirement-evidence";
import type { TenderSummary } from "./tender-presentation";

const demoTenders: readonly TenderSummary[] = [
  {
    id: "synthetic-tender-one",
    title: "Synthetic municipal equipment tender for visual review",
    buyer: "Example procurement team",
    isDemonstration: true,
    lifecycleStatus: "ACTIVE",
    sourceTenderNumber: "DEMO-001",
    workspace: { processingProgress: 70, status: "REVIEW_READY" },
  },
  {
    id: "synthetic-tender-two",
    title: "Synthetic supply tender with a longer title to inspect wrapping",
    buyer: "Example district office",
    isDemonstration: true,
    lifecycleStatus: "ACTIVE",
    sourceTenderNumber: "DEMO-002",
    workspace: { processingProgress: 25, status: "PROCESSING" },
  },
];

const demoRun: AssessmentRun = {
  comparisonPolicyVersion: "visual-preview",
  extractionRunId: "synthetic-extraction",
  id: "synthetic-assessment-run",
  invalidatedAt: null,
  progressPercentage: 100,
  publicMessage: "Synthetic illustration only",
  riskAnalysisRunId: "synthetic-risk-run",
  status: "COMPLETE",
  tenderVersionId: "synthetic-tender-version",
};

const demoMatrix: MatrixResult = {
  counts: [{ _count: 1, currentState: "MISSING_EVIDENCE" }],
  items: [
    {
      currentState: "MISSING_EVIDENCE",
      currentEvidence: null,
      evidenceLinks: [],
      id: "synthetic-assessment-item",
      proposedConfidence: "LOW",
      proposedRationale:
        "A reviewer would need to examine cited company evidence.",
      proposedState: "MISSING_EVIDENCE",
      requirementCategory: "COMPANY_REGISTRATION",
      requirementObligation: "REQUIRED",
      reviewState: "UNREVIEWED",
      structuredRequirement: {
        id: "synthetic-requirement",
        normalizedStatement: "Provide a current registration certificate.",
        title: "Company registration",
      },
      tenderCitation: {
        boundedExcerpt: "The bidder should provide registration evidence.",
        documentName: "Synthetic tender excerpt (not a real document)",
        pageNumber: 2,
        tenderDocumentId: "synthetic-source",
      },
      uncertainty: "No reviewed direct support is linked.",
    },
  ],
  total: 1,
};

const demoAttachments: readonly Attachment[] = [
  {
    attachment_id: "synthetic-attachment",
    context_only: true,
    detached_at: null,
    stale_requirement: false,
    document: {
      displayName: "Synthetic registration example.pdf",
      status: "READY",
      verificationStatus: "UNVERIFIED",
      expiryDate: null,
    },
    version: {
      originalFilename: "synthetic-registration.pdf",
      uploadSession: null,
    },
  },
];

export function VisualPreview({
  view,
}: {
  readonly view: "dashboard" | "evidence";
}): React.JSX.Element {
  const router = useRouter();
  const [filter, setFilter] = useState<
    "ALL" | "ACTIVE" | "IN_PROGRESS" | "COMPLETED"
  >("ALL");
  const [message, setMessage] = useState("");
  const hrefFor = (page: string): string | null =>
    page === "dashboard"
      ? "/visual-preview/dashboard"
      : page === "tenders" || page.startsWith("tender:")
        ? "/visual-preview/evidence"
        : null;
  const shell: ShellData = {
    page: view === "dashboard" ? "dashboard" : "tenders",
    pathname: `/visual-preview/${view}`,
    activeOrgId: "synthetic-org",
    activeTenderId: null,
    organizations: [
      {
        id: "synthetic-org",
        name: "Synthetic demonstration organisation",
        role: "OWNER",
        initials: "SD",
        color: "#FF5722",
      },
    ],
    tenders: demoTenders.map((tender) => ({
      id: tender.id,
      title: tender.title,
      buyer: tender.buyer,
      isDraft: false,
    })),
    activeStage: view === "evidence" ? "eligibility" : null,
    userName: "Demo Visitor",
    userEmail: "demo@example.invalid",
    busy: false,
    setPage: (page) => {
      const href = hrefFor(page);
      if (href) router.push(href);
      else setMessage("This action is unavailable in the visual preview.");
    },
    hrefFor,
    setActiveOrg: () => setMessage("Only synthetic data is shown here."),
    openTender: () => router.push("/visual-preview/evidence"),
    signOut: () => setMessage("This visual preview has no signed-in session."),
  };

  return (
    <ShellView data={shell}>
      <div className="zai-design mb-6 rounded-xl border border-[#FFB799] bg-[#FFF1EB] px-5 py-4 text-[#1E1F22]">
        <strong>Visual preview · synthetic data</strong>
        <p>
          This page has no account session, live tender, file access or API
          connection. Actions and review decisions are disabled.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
      {view === "dashboard" ? (
        <DashboardView
          tenders={demoTenders}
          userName="Demo Visitor"
          organisationName="Synthetic demonstration organisation"
          organisationId={null}
          recommendations={[]}
          onCreate={() =>
            setMessage("Tender creation is unavailable in the visual preview.")
          }
          filter={filter}
          onFilter={setFilter}
          companyProgress={null}
        />
      ) : (
        <div className="zai-design space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-[#1E1F22]">
              Synthetic eligibility workspace
            </h1>
            <p className="text-[#4B5563]">
              Inspect layout and responsive behavior only. No eligibility
              conclusion is represented here.
            </p>
          </div>
          <RequirementEvidence
            organisationId="synthetic-org"
            tenderId="synthetic-tender-one"
            versionId="synthetic-tender-version"
            requirementId="synthetic-requirement"
            canEdit={false}
            previewItems={demoAttachments}
          />
          <EvidenceMatrix
            organisationId="synthetic-org"
            tenderId="synthetic-tender-one"
            versionId="synthetic-tender-version"
            presentation="focused"
            previewSnapshot={{ run: demoRun, matrix: demoMatrix }}
          />
        </div>
      )}
    </ShellView>
  );
}
