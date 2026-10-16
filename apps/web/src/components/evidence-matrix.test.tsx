import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceMatrix } from "./evidence-matrix";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  apiRequest,
}));

describe("EvidenceMatrix", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("renders an active assessment safely when snapshot metadata is not available yet", async () => {
    apiRequest.mockImplementation((path: string): unknown => {
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
      screen.queryByRole("button", { name: "Refresh requirements check" }),
    ).not.toBeInTheDocument();
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
