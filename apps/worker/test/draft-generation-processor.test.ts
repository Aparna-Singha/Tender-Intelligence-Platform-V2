import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalCompanyEvidenceSourceText,
  canonicalCompanyEvidenceStatement,
} from "@tender/domain";
import {
  companyFactClaimBindsToAuthority,
  DraftGenerationProcessor,
  isDraftGenerationJob,
} from "../src/draft-generation-processor.js";

const source = readFileSync(
  new URL("../src/draft-generation-processor.ts", import.meta.url),
  "utf8",
);

describe("fact-constrained draft worker", () => {
  it("accepts only opaque tenant-scoped job payloads", () => {
    expect(
      isDraftGenerationJob({
        draftGenerationRunId: "run",
        kind: "DRAFT_GENERATION",
        organisationId: "organisation",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isDraftGenerationJob({
        kind: "DRAFT_GENERATION",
        organisationId: "organisation",
        requestId: "request",
        tenderId: "browser-selected",
      }),
    ).toBe(false);
  });

  it("rechecks every authoritative prerequisite including CONTINUE", () => {
    expect(source).toContain("assertCurrentAuthority");
    expect(source).toContain('decision: "CONTINUE"');
    expect(source).toContain("supersededAt: null");
    expect(source).toContain("activeEarlyRiskRun");
    expect(source).toContain("activeEligibilityAssessmentRun");
    expect(source).toContain("activeExtractionRun");
  });

  it("hard-bounds retrieval to the snapshotted tenant and source records", () => {
    expect(source).toContain('"organisation_id" = ${run.organisationId}::uuid');
    expect(source).toContain('"tender_id" = ${run.tenderId}::uuid');
    expect(source).toContain('"index_run_id" = ${run.ragIndexRunId}::uuid');
    expect(source).toContain("snapshottedChunkIds.map");
    expect(source).toContain("Prisma.sql`${id}::uuid`");
    expect(source).toContain("DRAFT_MAX_CONTEXTS_PER_SECTION");
  });

  it("does not consume chat answers as drafting authority", () => {
    expect(source).not.toContain("ragAnswer");
    expect(source).not.toContain("ragMessage");
    expect(source).not.toContain("conversation");
  });

  it("fails before marking output complete when citations or company facts are invalid", () => {
    expect(source).toContain("DRAFT_CITATION_INVALID");
    expect(source).toContain("COMPANY_FACT_SOURCE_INVALID");
    expect(source).toContain("COMPANY_FACT_CLAIM_MISMATCH");
    expect(source).toContain("companyFactClaimBindsToAuthority");
    expect(source).toContain("DRAFT_UNCLAIMED_MATERIAL_CONTENT");
    expect(source).toContain("DRAFT_CLAIM_SOURCE_CLASS_INVALID");
    expect(source.indexOf("verifyCitationHandles")).toBeLessThan(
      source.indexOf('status: "COMPLETE"'),
    );
    expect(source).toContain("evidenceFactVersionId");
  });

  it("binds approved company claims to the canonical accepted fact", () => {
    const canonical = canonicalCompanyEvidenceStatement({
      factType: "GST_REGISTRATION",
      value: {
        booleanValue: null,
        currency: null,
        dateValue: null,
        financialYear: null,
        numberValue: null,
        scope: null,
        textListValue: [],
        textValue: "The bidder has valid GST registration.",
        unit: null,
      },
    });
    const authority = {
      canonicalSourceText: `${canonical}. Evidence: GST registration certificate confirms validity.`,
      canonicalStatement: canonical,
    };

    expect(
      companyFactClaimBindsToAuthority(
        "The bidder has completed ten smart-city projects.",
        [authority],
      ),
    ).toBe(false);
    expect(
      companyFactClaimBindsToAuthority(
        "GST_REGISTRATION: The bidder has valid GST registration.",
        [authority],
      ),
    ).toBe(true);
    expect(
      companyFactClaimBindsToAuthority(
        `${canonical}. Evidence: GST registration certificate confirms validity.`,
        [authority],
      ),
    ).toBe(false);
  });

  it("uses one canonical company-evidence format for provider context and validation", () => {
    const cases = [
      {
        expected: "TEXT_FACT: Valid GST registration",
        factType: "TEXT_FACT",
        value: factValue({ textValue: "Valid GST registration" }),
      },
      {
        expected: "TURNOVER: 1250000.5 | INR",
        factType: "TURNOVER",
        value: factValue({
          currency: "INR",
          numberValue: { toString: () => "1250000.5" },
        }),
      },
      {
        expected: "FY_TURNOVER: 1250000.5 | INR | 2025-26",
        factType: "FY_TURNOVER",
        value: factValue({
          currency: "INR",
          financialYear: "2025-26",
          numberValue: { toString: () => "1250000.5" },
        }),
      },
      {
        expected: "INCORPORATION_DATE: 2020-04-01",
        factType: "INCORPORATION_DATE",
        value: factValue({ dateValue: new Date("2020-04-01T00:00:00.000Z") }),
      },
      {
        expected: "MSME_REGISTERED: true",
        factType: "MSME_REGISTERED",
        value: factValue({ booleanValue: true }),
      },
      {
        expected: "CERTIFICATIONS: ISO 9001, ISO 27001",
        factType: "CERTIFICATIONS",
        value: factValue({ textListValue: ["ISO 9001", "ISO 27001"] }),
      },
      {
        expected: "SERVICE_CAPACITY: 12 | engineers | PAN India",
        factType: "SERVICE_CAPACITY",
        value: factValue({
          numberValue: { toString: () => "12" },
          scope: "PAN India",
          unit: "engineers",
        }),
      },
    ];

    for (const item of cases) {
      expect(
        canonicalCompanyEvidenceStatement({
          factType: item.factType,
          value: item.value,
        }),
      ).toBe(item.expected);
      expect(
        canonicalCompanyEvidenceSourceText({
          boundedExcerpt: "Accepted source excerpt.",
          factType: item.factType,
          value: item.value,
        }),
      ).toBe(`${item.expected}. Evidence: Accepted source excerpt.`);
    }
  });

  it("rejects generated human-authored commitments without reviewed commitment authority", () => {
    expect(source).toContain("HUMAN_COMMITMENT_SOURCE_INVALID");
    expect(source.indexOf("HUMAN_COMMITMENT_SOURCE_INVALID")).toBeLessThan(
      source.indexOf('status: "COMPLETE"'),
    );
  });

  it("rejects an approved company fact claim bound to unrelated accepted evidence before persistence", async () => {
    const { database, processor } = processorFixture({
      generated: {
        claims: [
          {
            claim: "The bidder has completed ten smart-city projects.",
            claimClass: "APPROVED_COMPANY_FACT",
            handles: ["D1"],
            material: true,
          },
        ],
        content: "The bidder has completed ten smart-city projects.",
        placeholders: [],
        sectionKey: "company",
      },
    });

    await expect(processor.process(job, new AbortController().signal)).rejects.toThrow(
      "COMPANY_FACT_CLAIM_MISMATCH",
    );
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.draftGenerationRun.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETE" }) }),
    );
  });

  it("rejects unclaimed generated material before persistence", async () => {
    const { database, processor } = processorFixture({
      generated: {
        claims: [],
        content: "We have completed ten smart-city projects.",
        placeholders: [],
        sectionKey: "company",
      },
    });

    await expect(processor.process(job, new AbortController().signal)).rejects.toThrow(
      "DRAFT_UNCLAIMED_MATERIAL_CONTENT",
    );
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a false company capability misclassified as a tender source statement", async () => {
    const { database, processor } = processorFixture({
      chunk: tenderChunk("Bidders must describe relevant past experience."),
      generated: {
        claims: [
          {
            claim: "We have completed ten smart-city projects.",
            claimClass: "TENDER_SOURCE_STATEMENT",
            handles: ["D1"],
            material: true,
          },
        ],
        content: "We have completed ten smart-city projects.",
        placeholders: [],
        sectionKey: "company",
      },
    });

    await expect(processor.process(job, new AbortController().signal)).rejects.toThrow(
      "DRAFT_CLAIM_SOURCE_TEXT_MISMATCH",
    );
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unsupported commitment prose misclassified as a tender source statement", async () => {
    const { database, processor } = processorFixture({
      chunk: tenderChunk("Bidders must describe relevant past experience."),
      generated: {
        claims: [
          {
            claim:
              "The bidder commits to deploying 50 engineers within 24 hours.",
            claimClass: "TENDER_SOURCE_STATEMENT",
            handles: ["D1"],
            material: true,
          },
        ],
        content: "The bidder commits to deploying 50 engineers within 24 hours.",
        placeholders: [],
        sectionKey: "company",
      },
    });

    await expect(processor.process(job, new AbortController().signal)).rejects.toThrow(
      "DRAFT_CLAIM_SOURCE_TEXT_MISMATCH",
    );
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("rejects generated commitment prose without reviewed commitment authority before persistence", async () => {
    const { database, processor } = processorFixture({
      generated: {
        claims: [
          {
            claim:
              "The bidder commits to deploying 50 engineers within 24 hours.",
            claimClass: "HUMAN_AUTHORED_COMMITMENT",
            handles: [],
            material: true,
          },
        ],
        content: "The bidder commits to deploying 50 engineers within 24 hours.",
        placeholders: [],
        sectionKey: "company",
      },
    });

    await expect(processor.process(job, new AbortController().signal)).rejects.toThrow(
      "HUMAN_COMMITMENT_SOURCE_INVALID",
    );
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("persists an exact tender-source statement with proper source authority", async () => {
    const tenderStatement = "Bidders must describe relevant past experience.";
    const { database, processor, transaction } = processorFixture({
      chunk: tenderChunk(tenderStatement),
      generated: {
        claims: [
          {
            claim: tenderStatement,
            claimClass: "TENDER_SOURCE_STATEMENT",
            handles: ["D1"],
            material: true,
          },
        ],
        content: tenderStatement,
        placeholders: [],
        sectionKey: "company",
      },
    });

    await expect(processor.process(job, new AbortController().signal)).resolves.toBeUndefined();
    expect(database.$transaction).toHaveBeenCalled();
    expect(transaction.draftClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimText: tenderStatement,
          evidenceFactVersionId: null,
          supportState: "SUPPORTED",
        }),
      }),
    );
  });

  it("persists a matching canonical approved company fact as supported", async () => {
    const canonical = canonicalGstStatement();
    const { database, processor, transaction } = processorFixture({
      generated: {
        claims: [
          {
            claim: canonical,
            claimClass: "APPROVED_COMPANY_FACT",
            handles: ["D1"],
            material: true,
          },
        ],
        content: canonical,
        placeholders: [],
        sectionKey: "company",
      },
    });

    await expect(processor.process(job, new AbortController().signal)).resolves.toBeUndefined();
    expect(database.$transaction).toHaveBeenCalled();
    expect(transaction.draftClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimText: canonical,
          evidenceFactVersionId: "fact-version",
          supportState: "SUPPORTED",
        }),
      }),
    );
    expect(transaction.draftGenerationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETE" }),
      }),
    );
  });
});

const job = {
  draftGenerationRunId: "run",
  kind: "DRAFT_GENERATION" as const,
  organisationId: "organisation",
  requestId: "request",
};

function processorFixture({
  chunk: chunkOverride,
  generated,
}: {
  readonly chunk?: DraftTestChunk;
  readonly generated: Awaited<
    ReturnType<ConstructorParameters<typeof DraftGenerationProcessor>[2]["generateDraftSection"]>
  >;
}): {
  readonly database: {
    readonly $transaction: ReturnType<typeof vi.fn>;
    readonly draftGenerationRun: {
      readonly update: ReturnType<typeof vi.fn>;
    };
  };
  readonly processor: DraftGenerationProcessor;
  readonly transaction: {
    readonly draftClaim: { readonly create: ReturnType<typeof vi.fn> };
    readonly draftGenerationRun: {
      readonly update: ReturnType<typeof vi.fn>;
    };
  };
} {
  const run = {
    assessmentRunId: "assessment",
    checklistGenerationRunId: "checklist",
    draftId: null,
    draftType: "CONSOLIDATED_FIRST_DRAFT",
    evidenceSnapshotId: "snapshot",
    extractionRunId: "extraction",
    id: "run",
    inputSnapshot: { sources: [{ sourceKind: "RAG_CHUNK", sourceRecordId: "chunk" }] },
    inputSnapshotId: "input-snapshot",
    model: "gemini",
    organisationId: "organisation",
    provider: "gemini",
    pursuitDecisionId: "decision",
    ragIndexRunId: "rag",
    requestedByUserId: "user",
    riskAnalysisRunId: "risk",
    sourceFingerprint: "fingerprint",
    sourceMode: "TENDER_AND_APPROVED_COMPANY_EVIDENCE",
    status: "GENERATING",
    templateVersionId: "template-version",
    tenderId: "tender",
    tenderVersionId: "version",
    title: "Draft",
  };
  const chunk = chunkOverride ?? {
    chunk_id: "chunk",
    clause_label: null,
    content: canonicalCompanyEvidenceSourceText({
      boundedExcerpt: "GST registration certificate confirms validity.",
      factType: "GST_REGISTRATION",
      value: gstValue(),
    }),
    content_checksum: "a".repeat(64),
    document_name: "GST.pdf",
    extraction_citation_id: null,
    page_number: 1,
    source_class: "COMPANY_EVIDENCE",
    source_record_id: "fact",
  };
  const transaction = {
    auditEvent: { create: vi.fn() },
    companyEvidenceFact: {
      findFirst: vi.fn().mockResolvedValue({
        currentVersion: {
          ...gstValue(),
          citations: [
            {
              boundedExcerpt: "GST registration certificate confirms validity.",
              id: "citation",
            },
          ],
          id: "fact-version",
          reviewState: "ACCEPTED",
        },
        factType: "GST_REGISTRATION",
      }),
    },
    draft: {
      create: vi.fn().mockResolvedValue({ id: "draft" }),
      update: vi.fn(),
    },
    draftClaim: { create: vi.fn().mockResolvedValue({ id: "claim" }) },
    draftClaimCitation: { create: vi.fn() },
    draftGenerationRun: {
      findFirst: vi.fn().mockResolvedValue({ id: "run" }),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    draftPlaceholder: { create: vi.fn() },
    draftSection: { create: vi.fn().mockResolvedValue({ id: "section" }) },
    draftVersion: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "draft-version" }),
    },
  };
  const database = {
    $queryRaw: vi.fn().mockResolvedValue([chunk]),
    $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    auditEvent: { create: vi.fn() },
    checklistGenerationRun: { findFirst: vi.fn().mockResolvedValue({ id: "checklist" }) },
    draftGenerationRun: {
      findFirst: vi.fn().mockResolvedValue(run),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    draftHumanInput: { findMany: vi.fn().mockResolvedValue([]) },
    draftTemplateVersion: {
      findFirst: vi.fn().mockResolvedValue({
        sections: [
          {
            allowedClaimClasses: [
              "APPROVED_COMPANY_FACT",
              "HUMAN_AUTHORED_COMMITMENT",
              "PLACEHOLDER",
              "TENDER_SOURCE_STATEMENT",
            ],
            formattingGuidance: "Concise.",
            heading: "Company",
            key: "company",
            order: 0,
            requiredSourceClasses: [],
          },
        ],
        template: {},
      }),
    },
    earlyPursuitDecision: { findFirst: vi.fn().mockResolvedValue({ id: "decision" }) },
    ragIndexRun: { findFirst: vi.fn().mockResolvedValue({ id: "rag" }) },
    tender: {
      findFirst: vi.fn().mockResolvedValue({
        currentVersion: {
          activeEarlyRiskRun: { id: "risk" },
          activeEligibilityAssessmentRun: { id: "assessment" },
          activeExtractionRun: { id: "extraction" },
          id: "version",
        },
      }),
    },
  };
  const processor = new DraftGenerationProcessor(
    database as never,
    { embedQuery: vi.fn().mockResolvedValue(Array(768).fill(0.1)) } as never,
    { generateDraftSection: vi.fn().mockResolvedValue(generated) } as never,
  );
  return { database, processor, transaction };
}

interface DraftTestChunk {
  readonly chunk_id: string;
  readonly clause_label: string | null;
  readonly content: string;
  readonly content_checksum: string;
  readonly document_name: string;
  readonly extraction_citation_id: string | null;
  readonly page_number: number | null;
  readonly source_class: string;
  readonly source_record_id: string;
}

function tenderChunk(content: string): DraftTestChunk {
  return {
    chunk_id: "chunk",
    clause_label: null,
    content,
    content_checksum: "b".repeat(64),
    document_name: "Tender.pdf",
    extraction_citation_id: "extraction-citation",
    page_number: 2,
    source_class: "TENDER_PRIMARY",
    source_record_id: "block",
  };
}

function canonicalGstStatement(): string {
  return canonicalCompanyEvidenceStatement({
    factType: "GST_REGISTRATION",
    value: gstValue(),
  });
}

function gstValue(): Parameters<typeof canonicalCompanyEvidenceStatement>[0]["value"] {
  return factValue({ textValue: "The bidder has valid GST registration." });
}

function factValue(
  overrides: Partial<Parameters<typeof canonicalCompanyEvidenceStatement>[0]["value"]>,
): Parameters<typeof canonicalCompanyEvidenceStatement>[0]["value"] {
  return {
    booleanValue: null,
    currency: null,
    dateValue: null,
    financialYear: null,
    numberValue: null,
    scope: null,
    textListValue: [],
    textValue: null,
    unit: null,
    ...overrides,
  };
}
