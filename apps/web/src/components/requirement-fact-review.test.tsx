import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequirementFactReview } from "./requirement-fact-review";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

const attachment = {
  attachment_id: "attachment-1",
  detached_at: null,
  document_id: "document-1",
  document_version_id: "document-version-1",
  document: {
    displayName: "Evidence.pdf",
    expiryDate: null,
    status: "READY",
    verificationStatus: "UNVERIFIED",
  },
};
const fact = {
  documentId: "document-1",
  factType: "GST_REGISTRATION",
  id: "fact-1",
  invalidatedAt: null,
  currentVersion: {
    citations: [
      {
        boundedExcerpt: "GST registration certificate",
        documentVersionId: "document-version-1",
        id: "citation-1",
        pageNumber: 1,
        validationStatus: "VALID",
      },
    ],
    documentVersionId: "document-version-1",
    id: "fact-version-1",
    reviewState: "ACCEPTED",
    textValue: "GST registered",
    validUntil: null,
  },
  reviews: [],
};

function view(onEvidenceLinked = vi.fn(), canLink = true): JSX.Element {
  return (
    <RequirementFactReview
      assessmentId="assessment-1"
      canLink={canLink}
      organisationId="org-1"
      requirementId="requirement-1"
      linkedFactVersionIds={[]}
      runId="run-1"
      tenderId="tender-1"
      versionId="version-1"
      onEvidenceLinked={onEvidenceLinked}
    />
  );
}

describe("requirement-level fact review", () => {
  beforeEach(() => apiRequest.mockReset());

  it("links only an accepted cited fact for the attached exact document version", async () => {
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        if (typeof path !== "string") return undefined;
        if (path.endsWith("/attachments")) return [attachment];
        if (path.endsWith("/company-evidence-facts")) return [fact];
        if (options?.method === "POST" && path.endsWith("/evidence-links"))
          return {};
        throw new Error(`Unexpected path: ${path}`);
      },
    );
    const onEvidenceLinked = vi.fn();
    render(view(onEvidenceLinked));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Link accepted fact as direct support",
      }),
    );
    await waitFor(() => expect(onEvidenceLinked).toHaveBeenCalledOnce());
    expect(apiRequest).toHaveBeenCalledWith(
      "/organisations/org-1/tenders/tender-1/eligibility-assessments/run-1/items/assessment-1/evidence-links",
      {
        method: "POST",
        body: JSON.stringify({
          evidence_fact_version_id: "fact-version-1",
          link_type: "DIRECT_SUPPORT",
        }),
      },
    );
    expect(
      screen.getByText(/human assessment decision is still required/),
    ).toBeVisible();
  });

  it("does not offer direct support for unreviewed or different-version facts", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (typeof path !== "string") return undefined;
      if (path.endsWith("/attachments")) return [attachment];
      if (path.endsWith("/company-evidence-facts"))
        return [
          {
            ...fact,
            currentVersion: {
              ...fact.currentVersion,
              reviewState: "UNREVIEWED",
            },
          },
          {
            ...fact,
            id: "fact-other",
            currentVersion: {
              ...fact.currentVersion,
              documentVersionId: "old-version",
            },
          },
        ];
      throw new Error(`Unexpected path: ${path}`);
    });
    render(view());
    expect(await screen.findByText(/GST registered/)).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "Link accepted fact as direct support",
      }),
    ).toBeNull();
  });

  it("requires a fresh assessment before linking when the historical source is stale", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (typeof path !== "string") return undefined;
      if (path.endsWith("/attachments")) return [attachment];
      if (path.endsWith("/company-evidence-facts")) return [fact];
      throw new Error(`Unexpected path: ${path}`);
    });
    render(view(vi.fn(), false));
    expect(
      await screen.findByText(
        /This assessment needs a fresh requirements check/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "Link accepted fact as direct support",
      }),
    ).toBeNull();
  });

  it("captures a bounded fact and citation against the attached exact version", async () => {
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        if (typeof path !== "string") return undefined;
        if (
          options?.method === "POST" &&
          path.endsWith("/company-evidence-facts")
        )
          return { id: "new-fact" };
        if (options?.method === "POST" && path.endsWith("/new-fact/citations"))
          return {};
        if (path.endsWith("/attachments")) return [attachment];
        if (path.endsWith("/company-evidence-facts")) return [];
        throw new Error(`Unexpected path: ${path}`);
      },
    );
    render(view());
    const form = (
      await screen.findByRole("button", { name: "Save cited fact for review" })
    ).closest("form")!;
    fireEvent.change(screen.getByLabelText("Attached READY document"), {
      target: { value: "attachment-1" },
    });
    fireEvent.change(screen.getByLabelText("Fact type"), {
      target: { value: "GST_REGISTRATION" },
    });
    fireEvent.change(screen.getByLabelText("Exact fact value"), {
      target: { value: "GST registered" },
    });
    fireEvent.change(screen.getByLabelText("Bounded source excerpt"), {
      target: { value: "GST registration certificate" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/company-evidence-facts/new-fact/citations",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const create = (apiRequest.mock.calls as unknown[][]).find(
      ([path, options]) =>
        typeof path === "string" &&
        path.endsWith("/company-evidence-facts") &&
        typeof options === "object" &&
        options !== null &&
        "method" in options &&
        options.method === "POST",
    );
    const request = create?.[1] as { body: string } | undefined;
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      document_id: "document-1",
      document_version_id: "document-version-1",
    });
    expect(
      screen.getByText(
        /Refresh the requirements check before linking new evidence/,
      ),
    ).toBeVisible();
  });
});
