import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EvidenceMatrix } from "./evidence-matrix";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  apiRequest,
}));

describe("EvidenceMatrix", () => {
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
});
