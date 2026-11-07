import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceMatrix } from "./evidence-matrix";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

describe("EvidenceMatrix", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("renders a read-only visual preview without API requests or review controls", () => {
    render(
      <EvidenceMatrix
        organisationId="synthetic-org"
        tenderId="synthetic-tender"
        versionId="synthetic-version"
        presentation="focused"
        previewSnapshot={{
          run: {
            comparisonPolicyVersion: "preview",
            extractionRunId: "synthetic-extraction",
            id: "synthetic-run",
            invalidatedAt: null,
            progressPercentage: 100,
            publicMessage: "Synthetic",
            riskAnalysisRunId: "synthetic-risk",
            status: "COMPLETE",
            tenderVersionId: "synthetic-version",
          },
          matrix: {
            counts: [],
            total: 1,
            items: [
              {
                id: "synthetic-item",
                currentState: "MISSING_EVIDENCE",
                currentEvidence: null,
                evidenceLinks: [],
                proposedConfidence: "LOW",
                proposedRationale: "Synthetic evidence is not reviewed.",
                proposedState: "MISSING_EVIDENCE",
                requirementCategory: "COMPANY_REGISTRATION",
                requirementObligation: "REQUIRED",
                reviewState: "UNREVIEWED",
                structuredRequirement: {
                  id: "synthetic-requirement",
                  title: "Synthetic requirement",
                  normalizedStatement: "Provide current registration evidence.",
                },
                tenderCitation: {
                  boundedExcerpt: "Synthetic source excerpt.",
                  documentName: "Synthetic tender",
                  pageNumber: 1,
                  tenderDocumentId: "synthetic-source",
                },
                uncertainty: "Unverified",
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("Synthetic requirement")).toBeVisible();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save review" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Refresh requirements check" }),
    ).toBeNull();
  });

  it.each([
    ["REASSESSMENT_REQUIRED", true],
    ["CURRENT", false],
  ] as const)(
    "distinguishes historical verification from %s support",
    async (status, stale) => {
      apiRequest.mockImplementation((path: string): unknown => {
        if (
          path.endsWith("/attachments") ||
          path.endsWith("/company-evidence-facts")
        )
          return [];
        if (path.endsWith("/versions/version-1/eligibility-assessments"))
          return [
            {
              id: "assessment-1",
              invalidatedAt: null,
              status: "COMPLETE",
              progressPercentage: 100,
              publicMessage: "Complete",
              tenderVersionId: "version-1",
            },
          ];
        if (path.endsWith("/eligibility-assessments/assessment-1/matrix"))
          return {
            counts: [{ currentState: "VERIFIED", _count: 1 }],
            total: 1,
            items: [
              {
                id: "item-1",
                currentState: "VERIFIED",
                reviewState: "FINALISED",
                currentEvidence: {
                  status,
                  checkedAt: "2026-11-07T00:00:00.000Z",
                  reasonCodes: stale ? ["DOCUMENT_REPLACED"] : [],
                },
                evidenceLinks: [],
                proposedConfidence: "1",
                proposedRationale: "Historically reviewed.",
                proposedState: "LIKELY_MET",
                requirementCategory: "EXPERIENCE",
                requirementObligation: "MANDATORY",
                structuredRequirement: {
                  id: "structured-1",
                  title: "Synthetic requirement",
                  normalizedStatement: "Evidence required.",
                },
                tenderCitation: {
                  boundedExcerpt: "Clause",
                  documentName: "Tender",
                  pageNumber: 1,
                  tenderDocumentId: "source",
                },
                uncertainty: "",
              },
            ],
          };
        throw new Error(`Unexpected API call: ${path}`);
      });
      render(
        <EvidenceMatrix
          currentAssessmentRunId="assessment-1"
          organisationId="org-1"
          presentation="focused"
          tenderId="tender-1"
          versionId="version-1"
        />,
      );
      expect(await screen.findByText("Synthetic requirement")).toBeVisible();
      expect(screen.getByText(/Historical decision:/)).toBeVisible();
      const review = screen.getByRole("article");
      expect(review).toHaveAttribute("tabindex", "0");
      review.focus();
      expect(review).toHaveFocus();
      if (stale) {
        expect(
          screen.getByText(
            /This previously verified decision needs reassessment/,
          ),
        ).toHaveTextContent("needs reassessment");
        expect(
          screen.getByText(
            /This previously verified decision needs reassessment/,
          ),
        ).toHaveTextContent("Document replaced");
      } else
        expect(
          screen.getByText(/Supporting evidence was current when checked at/),
        ).toBeVisible();
    },
  );

  it("renders an active assessment safely when snapshot metadata is not available yet", async () => {
    apiRequest.mockImplementation((path: string): unknown => {
      if (
        path.endsWith("/attachments") ||
        path.endsWith("/company-evidence-facts")
      )
        return [];
      if (path.endsWith("/versions/version-1/eligibility-assessments")) {
        return [
          {
            comparisonPolicyVersion: "policy-v1",
            extractionRunId: "extract-1",
            id: "assessment-1",
            invalidatedAt: null,
            progressPercentage: 60,
            publicMessage: "Comparison running",
            riskAnalysisRunId: "risk-1",
            snapshot: null,
            status: "RUNNING",
            tenderVersionId: "version-1",
          },
        ];
      }
      if (path.endsWith("/eligibility-assessments/assessment-1/matrix")) {
        return { counts: [], items: [], total: 0 };
      }
      if (path === "/organisations/org-1/documents?status=READY") {
        return [];
      }
      if (path === "/organisations/org-1/company-evidence-facts") {
        return [];
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <EvidenceMatrix
        currentAssessmentRunId="assessment-1"
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );

    expect(await screen.findByText("Comparison running")).toBeInTheDocument();
    expect(
      screen.getByText("Snapshot: Unavailable for this run."),
    ).toBeInTheDocument();
  });

  it("shows only contextual evidence review in focused presentation", async () => {
    apiRequest.mockImplementation((path: string): unknown => {
      if (
        path.endsWith("/attachments") ||
        path.endsWith("/company-evidence-facts")
      )
        return [];
      if (path.endsWith("/versions/version-1/eligibility-assessments")) {
        return [
          {
            comparisonPolicyVersion: "policy-v1",
            extractionRunId: "extract-1",
            id: "assessment-1",
            invalidatedAt: null,
            progressPercentage: 100,
            publicMessage: "Comparison complete",
            riskAnalysisRunId: "risk-1",
            snapshot: { capturedAt: "2026-08-24T09:00:00.000Z" },
            status: "COMPLETE",
            tenderVersionId: "version-1",
          },
        ];
      }
      if (path.endsWith("/eligibility-assessments/assessment-1/matrix")) {
        const item = (id: string, title: string): Record<string, unknown> => ({
          currentState: "HUMAN_REVIEW_REQUIRED",
          evidenceLinks: [
            {
              evidenceCitation: {
                boundedExcerpt: "Accepted company evidence excerpt.",
                documentId: "company-document-1",
                documentName: "Company evidence.pdf",
                pageNumber: 1,
                validationStatus: "VALID",
              },
              linkType: "DIRECT_SUPPORT",
            },
          ],
          id,
          proposedConfidence: "HIGH",
          proposedRationale: "The linked evidence needs a reviewer decision.",
          proposedState: "LIKELY_MET",
          requirementCategory: "EXPERIENCE",
          requirementObligation: "MANDATORY",
          reviewState: "UNREVIEWED",
          structuredRequirement: {
            id: `structured-${id}`,
            normalizedStatement: `${title} is required.`,
            title,
          },
          tenderCitation: {
            boundedExcerpt: "Tender source excerpt.",
            documentName: "Tender.pdf",
            pageNumber: 2,
            tenderDocumentId: "tender-document-1",
          },
          uncertainty: "Reviewer confirmation is required.",
        });
        return {
          counts: [],
          items: [
            item("requirement-1", "Relevant requirement"),
            item("requirement-2", "Unrelated requirement"),
          ],
          total: 2,
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <EvidenceMatrix
        currentAssessmentRunId="assessment-1"
        focusRequest={{
          assessmentId: "requirement-1",
          mode: "assessment",
          token: 1,
        }}
        organisationId="org-1"
        presentation="focused"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Relevant requirement" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unrelated requirement")).not.toBeInTheDocument();
    expect(
      screen.getByText("Accepted company evidence excerpt."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh requirements check" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Capture a bounded company-document fact"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Company evidence facts"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Assessment run")).not.toBeInTheDocument();
    expect(screen.queryByText(/Policy:/i)).not.toBeInTheDocument();
  });
});
