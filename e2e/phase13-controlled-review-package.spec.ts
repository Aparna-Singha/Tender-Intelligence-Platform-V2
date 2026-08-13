import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../packages/database/src/index";
import { unzipSync } from "fflate";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL must be set for Phase 13 browser validation.");
}

const prisma = createPrismaClient(databaseUrl);
const PASSWORD = "Phase13Password123";
const REQUEST_TIMEOUT_MS = 90_000;
const FIXTURE_NOW = new Date("2026-08-05T10:00:00.000Z");
const SOURCE_FINGERPRINT = sha256("phase13-source-fingerprint");
const READINESS_FINGERPRINT = sha256("phase13-readiness-fingerprint");

interface FixtureUser {
  readonly displayName: string;
  readonly email: string;
}

interface FixtureData {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly tenderVersionId: string;
  readonly users: {
    readonly admin: FixtureUser;
    readonly consultant: FixtureUser;
    readonly crossTenant: FixtureUser;
    readonly draftCreator: FixtureUser;
    readonly owner: FixtureUser;
    readonly platformAdmin: FixtureUser;
    readonly reviewer: FixtureUser;
    readonly tenderExecutive: FixtureUser;
  };
}

test.describe.configure({ mode: "serial" });

let fixture: FixtureData;
let firstZipHash = "";
let firstPdfHash = "";
let firstDownloadedPath = "";

test.beforeAll(async () => {
  await waitForHttpReady(
    `${process.env.API_PUBLIC_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000"}/ready`,
  );
  await waitForHttpReady(
    `http://127.0.0.1:${process.env.WORKER_HEALTH_PORT ?? "4001"}/ready`,
  );
  fixture = await seedPhase13Fixture(prisma);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("validates the release golden business workflow and downloaded artifact", async ({
  browser,
}) => {
  const owner = await loginAs(browser, fixture.users.owner, {
    width: 1440,
    height: 900,
  });
  const ownerPage = owner.page;
  const ownerTelemetry = captureBrowserQuality(ownerPage);
  await assertSeededGoldenWorkflowState();
  await navigateToExport(ownerPage, fixture);
  await assertWorkspaceStages(ownerPage, fixture);

  await expect(
    ownerPage.getByRole("heading", { name: "Controlled review package" }),
  ).toBeVisible();
  await expect(
    ownerPage.getByText(/do not approve or perform external/i),
  ).toBeVisible();
  await expect(
    ownerPage.getByRole("button", { name: "Authorise one-minute download" }),
  ).toHaveCount(0);
  expect(ownerTelemetry.errors).toEqual([]);
  expect(ownerTelemetry.failedRequests).toEqual([]);

  const existingRunCount = await prisma.controlledReviewPackageRun.count({
    where: { tenderId: fixture.tenderId },
  });

  await ownerPage.once("dialog", (dialog) => dialog.accept());
  await ownerPage
    .getByRole("button", { name: "Generate review package" })
    .click();

  const firstRun = await waitForGeneratedRun(existingRunCount);
  await expect
    .poll(() => latestRunReviewStatus(firstRun.id))
    .not.toBe("APPROVED");

  await ownerPage.once("dialog", (dialog) =>
    dialog.accept(
      "Requester self-approval must remain blocked for controlled downloads.",
    ),
  );
  await ownerPage
    .getByRole("button", { name: "Approve for controlled download" })
    .click();
  await expect
    .poll(async () =>
      prisma.packageApproval.count({
        where: { runId: firstRun.id },
      }),
    )
    .toBe(0);

  const reviewer = await loginAs(browser, fixture.users.reviewer, {
    width: 1440,
    height: 900,
  });
  const reviewerTelemetry = captureBrowserQuality(reviewer.page);
  await navigateToExport(reviewer.page, fixture);
  await reviewer.page
    .getByRole("textbox", { name: "Append-only review comment" })
    .fill(
      "Independent reviewer confirmed the generated package is ready for controlled download.",
    );
  await reviewer.page
    .getByRole("button", { name: "Record review complete" })
    .click();
  await expect
    .poll(
      async () =>
        prisma.controlledReviewPackageRun.findUnique({
          select: {
            reviewVersion: true,
            reviews: { select: { id: true } },
          },
          where: { id: firstRun.id },
        }),
      { timeout: REQUEST_TIMEOUT_MS },
    )
    .toMatchObject({
      reviewVersion: 1,
      reviews: [{ id: expect.any(String) }],
    });
  await reviewer.page.reload();
  await reviewer.page.once("dialog", (dialog) =>
    dialog.accept("Independent reviewer approval for controlled download."),
  );
  await reviewer.page
    .getByRole("button", { name: "Approve for controlled download" })
    .click();

  await expect
    .poll(async () => latestRunReviewStatus(firstRun.id), {
      timeout: REQUEST_TIMEOUT_MS,
    })
    .toBe("APPROVED");
  await expect(reviewer.page.getByText(/Approval history/i)).toBeVisible();
  expect(reviewerTelemetry.errors).toEqual([]);
  expect(reviewerTelemetry.failedRequests).toEqual([]);

  const firstDownload = await downloadCurrentPackage(ownerPage);
  const firstInspection = inspectControlledPackageZip(firstDownload);
  firstZipHash = firstInspection.zipSha256;
  firstPdfHash = firstInspection.pdfSha256;
  firstDownloadedPath = firstInspection.downloadedPath;

  const secondExistingRunCount = await prisma.controlledReviewPackageRun.count({
    where: { tenderId: fixture.tenderId },
  });
  await ownerPage.once("dialog", (dialog) => dialog.accept());
  await ownerPage
    .getByRole("button", { name: "Generate review package" })
    .click();

  const secondRun = await waitForGeneratedRun(secondExistingRunCount);
  await reviewer.page.reload();
  await reviewer.page
    .getByRole("textbox", { name: "Append-only review comment" })
    .fill(
      "Independent reviewer confirmed the regenerated package is identical and still eligible for controlled download.",
    );
  await reviewer.page
    .getByRole("button", { name: "Record review complete" })
    .click();
  await expect
    .poll(
      async () =>
        prisma.controlledReviewPackageRun.findUnique({
          select: {
            reviewVersion: true,
            reviews: { select: { id: true } },
          },
          where: { id: secondRun.id },
        }),
      { timeout: REQUEST_TIMEOUT_MS },
    )
    .toMatchObject({
      reviewVersion: 1,
      reviews: [{ id: expect.any(String) }],
    });
  await reviewer.page.reload();
  await reviewer.page.once("dialog", (dialog) =>
    dialog.accept(
      "Second independent reviewer approval for controlled download.",
    ),
  );
  await reviewer.page
    .getByRole("button", { name: "Approve for controlled download" })
    .click();

  await expect
    .poll(async () => latestRunReviewStatus(secondRun.id), {
      timeout: REQUEST_TIMEOUT_MS,
    })
    .toBe("APPROVED");
  await expect
    .poll(async () =>
      prisma.controlledReviewPackageRun.findUnique({
        select: { reviewStatus: true },
        where: { id: firstRun.id },
      }),
    )
    .toMatchObject({ reviewStatus: "SUPERSEDED" });

  const secondDownload = await downloadCurrentPackage(ownerPage);
  const secondInspection = inspectControlledPackageZip(secondDownload);
  expect(secondInspection.zipSha256).toBe(firstZipHash);
  expect(secondInspection.pdfSha256).toBe(firstPdfHash);

  const admin = await loginAs(browser, fixture.users.admin, {
    width: 1440,
    height: 900,
  });
  const adminTelemetry = captureBrowserQuality(admin.page);
  await navigateToExport(admin.page, fixture);
  await admin.page.once("dialog", (dialog) =>
    dialog.accept("Administrative withdrawal of current controlled download."),
  );
  await admin.page
    .getByRole("button", { name: "Revoke controlled download" })
    .click();

  await expect
    .poll(async () => latestRunReviewStatus(secondRun.id), {
      timeout: REQUEST_TIMEOUT_MS,
    })
    .toBe("REVOKED");
  await expect(
    ownerPage.getByRole("button", { name: "Authorise one-minute download" }),
  ).toHaveCount(0);
  expect(adminTelemetry.errors).toEqual([]);
  expect(adminTelemetry.failedRequests).toEqual([]);

  await owner.context.close();
  await reviewer.context.close();
  await admin.context.close();
});

test("validates responsive rendering and forbidden access paths", async ({
  browser,
}) => {
  const ownerMobile = await loginAs(browser, fixture.users.owner, {
    width: 390,
    height: 844,
  });
  await navigateToExport(ownerMobile.page, fixture);
  const overflow = await ownerMobile.page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  const consultant = await loginAs(browser, fixture.users.consultant, {
    width: 1280,
    height: 800,
  });
  await navigateToExport(consultant.page, fixture);
  await expect(
    consultant.page.getByRole("heading", { name: "Controlled review package" }),
  ).toBeVisible();

  const platformAdmin = await loginAs(browser, fixture.users.platformAdmin, {
    width: 1280,
    height: 800,
  });
  await navigateToExport(platformAdmin.page, fixture);
  await expect(platformAdmin.page.getByRole("combobox")).toHaveValue("");
  await expect(
    platformAdmin.page.getByRole("heading", {
      name: "Controlled review package",
    }),
  ).toHaveCount(0);

  const crossTenant = await loginAs(browser, fixture.users.crossTenant, {
    width: 1280,
    height: 800,
  });
  await navigateToExport(crossTenant.page, fixture);
  await expect(crossTenant.page.getByRole("combobox")).toHaveValue("");
  await expect(
    crossTenant.page.getByRole("heading", {
      name: "Controlled review package",
    }),
  ).toHaveCount(0);

  await ownerMobile.context.close();
  await consultant.context.close();
  await platformAdmin.context.close();
  await crossTenant.context.close();
});

function sha256(value: string | Uint8Array | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(
      password,
      salt,
      32,
      { N: 2 ** 17, maxmem: 256 * 1024 * 1024, p: 1, r: 8 },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(
          [
            "scrypt",
            "ln=17,r=8,p=1",
            salt.toString("base64url"),
            derivedKey.toString("base64url"),
          ].join("$"),
        );
      },
    );
  });
}

async function seedPhase13Fixture(
  database: PrismaClient,
): Promise<FixtureData> {
  const tag = Date.now().toString(36);
  const passwordHash = await hashPassword(PASSWORD);
  const owner = await database.user.create({
    data: {
      displayName: "Phase 13 Owner",
      email: `phase13-owner-${tag}@example.test`,
      passwordHash,
    },
  });
  const reviewer = await database.user.create({
    data: {
      displayName: "Phase 13 Reviewer",
      email: `phase13-reviewer-${tag}@example.test`,
      passwordHash,
    },
  });
  const admin = await database.user.create({
    data: {
      displayName: "Phase 13 Admin",
      email: `phase13-admin-${tag}@example.test`,
      passwordHash,
    },
  });
  const tenderExecutive = await database.user.create({
    data: {
      displayName: "Phase 13 Executive",
      email: `phase13-executive-${tag}@example.test`,
      passwordHash,
    },
  });
  const consultant = await database.user.create({
    data: {
      displayName: "Phase 13 Consultant",
      email: `phase13-consultant-${tag}@example.test`,
      passwordHash,
    },
  });
  const draftCreator = await database.user.create({
    data: {
      displayName: "Phase 13 Draft Creator",
      email: `phase13-draft-creator-${tag}@example.test`,
      passwordHash,
    },
  });
  const platformAdmin = await database.user.create({
    data: {
      displayName: "Phase 13 Platform Admin",
      email: `phase13-platform-admin-${tag}@example.test`,
      passwordHash,
      platformRole: "PLATFORM_ADMIN",
    },
  });
  const crossTenant = await database.user.create({
    data: {
      displayName: "Phase 13 Cross Tenant",
      email: `phase13-cross-tenant-${tag}@example.test`,
      passwordHash,
    },
  });

  const organisation = await database.organisation.create({
    data: {
      createdByUserId: owner.id,
      name: `Phase 13 Fixture ${tag}`,
      type: "MSME",
    },
  });
  await database.organisationMembership.createMany({
    data: [
      { organisationId: organisation.id, role: "OWNER", userId: owner.id },
      {
        organisationId: organisation.id,
        role: "REVIEWER",
        userId: reviewer.id,
      },
      { organisationId: organisation.id, role: "ADMIN", userId: admin.id },
      {
        organisationId: organisation.id,
        role: "TENDER_EXECUTIVE",
        userId: tenderExecutive.id,
      },
      {
        organisationId: organisation.id,
        role: "CONSULTANT",
        userId: consultant.id,
      },
      {
        organisationId: organisation.id,
        role: "CONSULTANT",
        userId: draftCreator.id,
      },
    ],
  });

  const otherOrganisation = await database.organisation.create({
    data: {
      createdByUserId: crossTenant.id,
      name: `Phase 13 Other Tenant ${tag}`,
      type: "CONSULTANT",
    },
  });
  await database.organisationMembership.create({
    data: {
      organisationId: otherOrganisation.id,
      role: "OWNER",
      userId: crossTenant.id,
    },
  });

  const tender = await database.tender.create({
    data: {
      buyer: "Phase 13 Buyer",
      createdByUserId: owner.id,
      lifecycleStatus: "SOURCE_READY",
      officialSourceUrl: "https://example.test/tenders/phase13",
      sourceTenderNumber: `PH13-${tag}`,
      sourceType: "MANUAL_UPLOAD",
      submissionDeadline: new Date("2026-09-30T10:00:00.000Z"),
      title: `Phase 13 Controlled Package ${tag}`,
      organisationId: organisation.id,
    },
  });
  const tenderVersion = await database.tenderVersion.create({
    data: {
      createdByUserId: owner.id,
      reason: "Initial controlled package fixture source upload",
      sourceFingerprint: SOURCE_FINGERPRINT,
      sourceProvenance: "manual fixture upload",
      sourceSnapshot: { fixture: "phase13", role: "PRIMARY" },
      tenderId: tender.id,
      versionNumber: 1,
    },
  });
  await database.tender.update({
    data: { currentVersionId: tenderVersion.id },
    where: { id: tender.id },
  });
  await database.tenderWorkspace.create({
    data: {
      createdByUserId: owner.id,
      organisationId: organisation.id,
      processingProgress: 100,
      sourceSectionStatus: "READY",
      status: "SOURCE_READY",
      tenderId: tender.id,
    },
  });

  const tenderDocument = await database.tenderDocument.create({
    data: {
      approvedObjectKey: `fixtures/${tag}/tender-source.pdf`,
      declaredMimeType: "application/pdf",
      detectedMimeType: "application/pdf",
      displayFilename: "tender-source.pdf",
      extension: "pdf",
      organisationId: organisation.id,
      originalFilename: "tender-source.pdf",
      provenance: "Phase 13 fixture source",
      quarantineObjectKey: `fixtures/${tag}/quarantine/tender-source.pdf`,
      role: "PRIMARY",
      sha256: sha256("phase13-tender-source"),
      sizeBytes: 4096n,
      status: "READY",
      tenderVersionId: tenderVersion.id,
      uploadCompletedAt: FIXTURE_NOW,
      uploadSessionExpiresAt: new Date("2026-08-05T11:00:00.000Z"),
      uploadedByUserId: owner.id,
    },
  });

  const extractionRun = await database.extractionRun.create({
    data: {
      completedAt: FIXTURE_NOW,
      currentStage: "COMPLETE",
      idempotencyKey: `phase13-extraction-${tag}`,
      organisationId: organisation.id,
      parserPolicyVersion: "deterministic-parser-v1",
      progressPercentage: 100,
      publicMessage: "Extraction complete",
      requestedByUserId: owner.id,
      sourceFingerprint: SOURCE_FINGERPRINT,
      startedAt: FIXTURE_NOW,
      status: "COMPLETE",
      structuringPolicyVersion: "deterministic-structure-v1",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      triggerType: "USER",
    },
  });
  await database.tenderVersion.update({
    data: { activeExtractionRunId: extractionRun.id },
    where: { id: tenderVersion.id },
  });
  const extractionDocument = await database.extractionRunDocument.create({
    data: {
      detectedFormat: "pdf",
      extractionRunId: extractionRun.id,
      parserConfiguration: { fixture: true },
      parserName: "phase13-fixture-parser",
      parserVersion: "1.0.0",
      sourceChecksum: tenderDocument.sha256,
      status: "COMPLETE",
      tenderDocumentId: tenderDocument.id,
      warningCount: 0,
    },
  });
  const extractedUnit = await database.extractedUnit.create({
    data: {
      characterCount: 56,
      extractionRunDocumentId: extractionDocument.id,
      extractionRunId: extractionRun.id,
      ocrStatus: "NOT_REQUIRED",
      parserConfidence: "HIGH",
      unitIndex: 1,
      unitType: "PAGE",
    },
  });
  const extractedBlock = await database.extractedBlock.create({
    data: {
      blockType: "PARAGRAPH",
      confidence: "HIGH",
      extractedUnitId: extractedUnit.id,
      extractionRunDocumentId: extractionDocument.id,
      extractionRunId: extractionRun.id,
      normalizedText: "The bidder shall maintain valid GST registration.",
      readingOrder: 0,
      sourceEndOffset: 56,
      sourceStartOffset: 0,
    },
  });
  const structuredRequirement = await database.structuredRequirement.create({
    data: {
      category: "REGISTRATION",
      confidence: "HIGH",
      extractionRunId: extractionRun.id,
      findingState: "FOUND",
      normalizedStatement: "The bidder shall maintain valid GST registration.",
      obligation: "MANDATORY",
      reviewState: "ACCEPTED",
      sourceWording: "The bidder shall maintain valid GST registration.",
      title: "Valid GST registration",
    },
  });
  const extractionCitation = await database.extractionCitation.create({
    data: {
      boundedExcerpt: "The bidder shall maintain valid GST registration.",
      clauseLabel: "Clause 4.1",
      documentName: "tender-source.pdf",
      endOffset: 56,
      extractionRunDocumentId: extractionDocument.id,
      extractionRunId: extractionRun.id,
      extractedBlockId: extractedBlock.id,
      extractedUnitId: extractedUnit.id,
      pageNumber: 1,
      sourceChecksum: tenderDocument.sha256,
      startOffset: 0,
      structuredRequirementId: structuredRequirement.id,
      tenderDocumentId: tenderDocument.id,
      validationStatus: "VALIDATED",
    },
  });

  const earlyRiskRun = await database.riskAnalysisRun.create({
    data: {
      completedAt: FIXTURE_NOW,
      currentStage: "COMPLETE",
      gateType: "EARLY",
      idempotencyKey: `phase13-early-risk-${tag}`,
      organisationId: organisation.id,
      progressPercentage: 100,
      publicMessage: "Early risk analysis complete",
      requestedByUserId: owner.id,
      riskPolicyVersion: "deterministic-risk-v1",
      sourceFingerprint: SOURCE_FINGERPRINT,
      startedAt: FIXTURE_NOW,
      status: "COMPLETE",
      summary: { fixture: true },
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      triggerType: "USER",
      extractionRunId: extractionRun.id,
    },
  });
  await database.tenderVersion.update({
    data: { activeEarlyRiskRunId: earlyRiskRun.id },
    where: { id: tenderVersion.id },
  });
  const earlyRiskFinding = await database.riskFinding.create({
    data: {
      blocking: false,
      category: "REGISTRATION",
      confidence: "HIGH",
      deterministicRuleId: "phase13-risk-rule",
      deterministicRuleVersion: "1",
      explanation:
        "Registration evidence should remain visible to the reviewer.",
      extractionRunId: extractionRun.id,
      findingStatus: "OPEN",
      materiality: "NON_MATERIAL",
      organisationId: organisation.id,
      reviewState: "REVIEWED",
      riskAnalysisRunId: earlyRiskRun.id,
      severity: "LOW",
      sourceInputFingerprint: SOURCE_FINGERPRINT,
      sourceSupportedRationale: "The source citation confirms the requirement.",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      title: "Registration evidence remains relevant",
    },
  });
  await database.riskFindingCitation.create({
    data: {
      extractionCitationId: extractionCitation.id,
      riskFindingId: earlyRiskFinding.id,
      validationStatus: "VALIDATED",
    },
  });
  const pursuitDecision = await database.earlyPursuitDecision.create({
    data: {
      acknowledgedLimitations: true,
      actorUserId: reviewer.id,
      decision: "CONTINUE",
      organisationId: organisation.id,
      rationale:
        "The opportunity remains suitable for controlled review testing.",
      riskAnalysisRunId: earlyRiskRun.id,
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      unresolvedHighCriticalCount: 0,
    },
  });

  const eligibilitySnapshot = await database.eligibilityInputSnapshot.create({
    data: {
      extractionRunId: extractionRun.id,
      fingerprint: SOURCE_FINGERPRINT,
      organisationId: organisation.id,
      pursuitDecisionId: pursuitDecision.id,
      riskAnalysisRunId: earlyRiskRun.id,
      tenderVersionId: tenderVersion.id,
    },
  });
  const eligibilityRun = await database.eligibilityAssessmentRun.create({
    data: {
      comparisonPolicyVersion: "deterministic-comparison-v1",
      completedAt: FIXTURE_NOW,
      currentStage: "COMPLETE",
      extractionRunId: extractionRun.id,
      idempotencyKey: `phase13-eligibility-${tag}`,
      normalisationPolicyVersion: "deterministic-normalisation-v1",
      organisationId: organisation.id,
      progressPercentage: 100,
      publicMessage: "Eligibility assessment complete",
      pursuitDecisionId: pursuitDecision.id,
      requestedByUserId: owner.id,
      riskAnalysisRunId: earlyRiskRun.id,
      snapshotId: eligibilitySnapshot.id,
      sourceFingerprint: SOURCE_FINGERPRINT,
      startedAt: FIXTURE_NOW,
      status: "COMPLETE",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      triggerType: "USER",
    },
  });
  await database.tenderVersion.update({
    data: { activeEligibilityAssessmentRunId: eligibilityRun.id },
    where: { id: tenderVersion.id },
  });
  const eligibilityAssessment = await database.eligibilityAssessment.create({
    data: {
      assessmentRunId: eligibilityRun.id,
      currentState: "VERIFIED",
      finalRationale:
        "The fixture includes authoritative registration support.",
      finalisedAt: FIXTURE_NOW,
      finalisedByUserId: reviewer.id,
      organisationId: organisation.id,
      policyVersion: "deterministic-comparison-v1",
      proposedConfidence: 0.95,
      proposedRationale:
        "The extracted requirement is supported by the approved fixture evidence.",
      proposedState: "VERIFIED",
      requirementCategory: "REGISTRATION",
      requirementObligation: "MANDATORY",
      reviewState: "FINALISED",
      structuredRequirementId: structuredRequirement.id,
      tenderCitationId: extractionCitation.id,
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      uncertainty: "None.",
      comparisonPolicyRule: "FIXTURE_MATCH",
    },
  });

  const checklistRun = await database.checklistGenerationRun.create({
    data: {
      assessmentRunId: eligibilityRun.id,
      checklistPolicyVersion: "deterministic-checklist-v1",
      completedAt: FIXTURE_NOW,
      currentStage: "COMPLETE",
      datePolicyVersion: "deterministic-date-v1",
      deduplicationPolicyVersion: "deterministic-dedup-v1",
      evidenceSnapshotId: eligibilitySnapshot.id,
      extractionRunId: extractionRun.id,
      idempotencyKey: `phase13-checklist-${tag}`,
      organisationId: organisation.id,
      priorityPolicyVersion: "deterministic-priority-v1",
      progressPercentage: 100,
      publicMessage: "Checklist generation complete",
      pursuitDecisionId: pursuitDecision.id,
      requestedByUserId: owner.id,
      riskAnalysisRunId: earlyRiskRun.id,
      sourceFingerprint: SOURCE_FINGERPRINT,
      startedAt: FIXTURE_NOW,
      status: "COMPLETE",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      triggerType: "USER",
    },
  });
  const checklistItem = await database.checklistItem.create({
    data: {
      completionCriteria:
        "Confirm the GST evidence remains current before download approval.",
      currentPriority: "MEDIUM",
      currentTitle: "Confirm GST evidence",
      dateIsOfficial: false,
      dateSource: "UNSPECIFIED",
      deduplicationKey: sha256(`phase13-checklist-${tag}`),
      evidenceNeedCategory: "DOCUMENT_METADATA",
      generationRuleId: "phase13-checklist-rule",
      generationRunId: checklistRun.id,
      itemType: "VERIFY_DOCUMENT",
      organisationId: organisation.id,
      policyVersion: "deterministic-checklist-v1",
      priorityRationale: "Supports final controlled review.",
      proposedExplanation:
        "Confirm the GST evidence remains current before download approval.",
      proposedPriority: "MEDIUM",
      proposedTitle: "Confirm GST evidence",
      sourceFingerprint: SOURCE_FINGERPRINT,
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
    },
  });

  const ragIndexRun = await database.ragIndexRun.create({
    data: {
      activatedAt: FIXTURE_NOW,
      chunkCount: 0,
      chunkPolicyVersion: "deterministic-rag-chunk-v1",
      completedAt: FIXTURE_NOW,
      currentStage: "COMPLETE",
      embeddingDimensions: 768,
      embeddingModel: "fixture-embedding-model",
      embeddingProvider: "fixture",
      extractionRunId: extractionRun.id,
      idempotencyKey: `phase13-rag-${tag}`,
      organisationId: organisation.id,
      requestedByUserId: owner.id,
      retrievalPolicyVersion: "deterministic-rag-retrieval-v1",
      sourceFingerprint: SOURCE_FINGERPRINT,
      sourceMode: "FULL_AUTHORISED_TENDER_CONTEXT",
      startedAt: FIXTURE_NOW,
      status: "COMPLETE",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
    },
  });

  const draftTemplate = await database.draftTemplate.create({
    data: {
      createdByUserId: owner.id,
      draftType: "CONSOLIDATED_FIRST_DRAFT",
      name: "Phase 13 draft template",
      organisationId: organisation.id,
    },
  });
  const draftTemplateVersion = await database.draftTemplateVersion.create({
    data: {
      activatedAt: FIXTURE_NOW,
      createdByUserId: owner.id,
      requiredReviewRole: "REVIEWER",
      sections: [{ key: "overview", title: "Overview" }],
      sourceFingerprint: SOURCE_FINGERPRINT,
      templateId: draftTemplate.id,
      templatePolicyVersion: "deterministic-draft-template-v1",
      versionNumber: 1,
    },
  });
  const draftGenerationRun = await database.draftGenerationRun.create({
    data: {
      assessmentRunId: eligibilityRun.id,
      checklistGenerationRunId: checklistRun.id,
      citationCount: 1,
      currentStage: "COMPLETE",
      draftingPolicyVersion: "deterministic-draft-v1",
      evidenceSnapshotId: eligibilitySnapshot.id,
      extractionRunId: extractionRun.id,
      idempotencyKey: `phase13-draft-${tag}`,
      model: "gemini-2.5-flash",
      organisationId: organisation.id,
      placeholderCount: 0,
      progressPercentage: 100,
      promptPolicyVersion: "deterministic-draft-prompt-v1",
      provider: "gemini",
      pursuitDecisionId: pursuitDecision.id,
      ragIndexRunId: ragIndexRun.id,
      requestedByUserId: owner.id,
      retrievalPolicyVersion: "deterministic-draft-retrieval-v1",
      riskAnalysisRunId: earlyRiskRun.id,
      sectionCount: 1,
      sourceFingerprint: SOURCE_FINGERPRINT,
      sourceMode: "FULL_AUTHORISED_TENDER_CONTEXT",
      startedAt: FIXTURE_NOW,
      status: "COMPLETE",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      templatePolicyVersion: "deterministic-draft-template-v1",
      templateVersionId: draftTemplateVersion.id,
      title: "Phase 13 consolidated draft",
      draftType: "CONSOLIDATED_FIRST_DRAFT",
      trigger: "USER",
      validatedClaimCount: 1,
    },
  });
  const draftInputSnapshot = await database.draftInputSnapshot.create({
    data: {
      assessmentRunId: eligibilityRun.id,
      checklistGenerationRunId: checklistRun.id,
      draftingPolicyVersion: "deterministic-draft-v1",
      evidenceSnapshotId: eligibilitySnapshot.id,
      extractionRunId: extractionRun.id,
      generationRunId: draftGenerationRun.id,
      model: "gemini-2.5-flash",
      organisationId: organisation.id,
      promptPolicyVersion: "deterministic-draft-prompt-v1",
      pursuitDecisionId: pursuitDecision.id,
      ragIndexRunId: ragIndexRun.id,
      retrievalPolicyVersion: "deterministic-draft-retrieval-v1",
      riskAnalysisRunId: earlyRiskRun.id,
      sourceFingerprint: SOURCE_FINGERPRINT,
      sourceMode: "FULL_AUTHORISED_TENDER_CONTEXT",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      templatePolicyVersion: "deterministic-draft-template-v1",
      templateVersionId: draftTemplateVersion.id,
      draftType: "CONSOLIDATED_FIRST_DRAFT",
      provider: "gemini",
    },
  });
  const draft = await database.draft.create({
    data: {
      createdByUserId: draftCreator.id,
      draftType: "CONSOLIDATED_FIRST_DRAFT",
      organisationId: organisation.id,
      tenderId: tender.id,
      title: "Phase 13 approved consolidated draft",
    },
  });
  const draftVersion = await database.draftVersion.create({
    data: {
      approvalRationale:
        "Approved for final-readiness and controlled review validation.",
      approvedAt: FIXTURE_NOW,
      approvedByUserId: reviewer.id,
      createdByUserId: draftCreator.id,
      draftId: draft.id,
      generationRunId: draftGenerationRun.id,
      inputSnapshotId: draftInputSnapshot.id,
      organisationId: organisation.id,
      reviewState: "APPROVED",
      sourceFingerprint: SOURCE_FINGERPRINT,
      templateVersionId: draftTemplateVersion.id,
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      versionNumber: 1,
    },
  });
  await database.draft.update({
    data: { currentVersionId: draftVersion.id },
    where: { id: draft.id },
  });
  await database.draftSection.create({
    data: {
      content:
        "Approved fixture draft text for controlled review. Human review remains required before any external action.",
      contentOrigin: "GENERATED",
      draftVersionId: draftVersion.id,
      heading: "Tender response overview",
      requirementIds: [structuredRequirement.id],
      reviewState: "APPROVED",
      sectionKey: "overview",
      sectionOrder: 1,
    },
  });
  const draftReviewEvent = await database.draftReviewEvent.create({
    data: {
      action: "APPROVE_VERSION",
      actorRoleAtAction: "REVIEWER",
      actorUserId: reviewer.id,
      draftVersionId: draftVersion.id,
      newState: "APPROVED",
      organisationId: organisation.id,
      priorState: "IN_REVIEW",
      rationale: "Independent reviewer approved the consolidated draft.",
      sourceFingerprint: SOURCE_FINGERPRINT,
      tenderId: tender.id,
      eventSequence: 1,
    },
  });

  const finalReadinessRun = await database.finalReadinessRun.create({
    data: {
      completedAt: FIXTURE_NOW,
      currentStage: "COMPLETE",
      evidenceExpiryPolicyVersion: "final-readiness-expiry-v1",
      eventSequence: 3,
      idempotencyKey: `phase13-readiness-${tag}`,
      inputFingerprint: READINESS_FINGERPRINT,
      organisationId: organisation.id,
      policyVersion: "final-readiness-deterministic-v1",
      progressPercentage: 100,
      queuedAt: FIXTURE_NOW,
      requestedByUserId: owner.id,
      requiredDraftPolicyVersion: "final-readiness-required-draft-v1",
      startedAt: FIXTURE_NOW,
      status: "COMPLETED",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
    },
  });
  const finalRiskRun = await database.riskAnalysisRun.create({
    data: {
      completedAt: FIXTURE_NOW,
      currentStage: "COMPLETE",
      extractionRunId: extractionRun.id,
      finalReadinessRunId: finalReadinessRun.id,
      gateType: "FINAL_READINESS",
      idempotencyKey: `phase13-final-risk-${tag}`,
      organisationId: organisation.id,
      progressPercentage: 100,
      publicMessage: "Final risk analysis complete",
      requestedByUserId: owner.id,
      riskPolicyVersion: "deterministic-risk-v1",
      sourceFingerprint: READINESS_FINGERPRINT,
      startedAt: FIXTURE_NOW,
      status: "COMPLETE",
      summary: { fixture: true },
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      triggerType: "USER",
    },
  });
  const finalRiskFinding = await database.riskFinding.create({
    data: {
      blocking: false,
      category: "DISCLAIMER",
      confidence: "HIGH",
      deterministicRuleId: "phase13-final-risk-rule",
      deterministicRuleVersion: "1",
      explanation:
        "The draft remains a human-reviewed artifact and not a submission.",
      extractionRunId: extractionRun.id,
      findingStatus: "OPEN",
      materiality: "NON_MATERIAL",
      organisationId: organisation.id,
      reviewState: "REVIEWED",
      riskAnalysisRunId: finalRiskRun.id,
      severity: "LOW",
      sourceInputFingerprint: READINESS_FINGERPRINT,
      sourceSupportedRationale:
        "Controlled review remains distinct from submission.",
      tenderId: tender.id,
      tenderVersionId: tenderVersion.id,
      title: "Human review remains required",
    },
  });
  const finalReadinessSnapshot =
    await database.finalReadinessInputSnapshot.create({
      data: {
        checklistGenerationRunId: checklistRun.id,
        createdByUserId: reviewer.id,
        earlyRiskRunId: earlyRiskRun.id,
        eligibilityAssessmentRunId: eligibilityRun.id,
        eligibilityInputSnapshotId: eligibilitySnapshot.id,
        evidenceExpiryPolicyVersion: "final-readiness-expiry-v1",
        extractionRunId: extractionRun.id,
        fingerprint: READINESS_FINGERPRINT,
        organisationId: organisation.id,
        policyVersion: "final-readiness-deterministic-v1",
        pursuitDecisionId: pursuitDecision.id,
        requiredDraftPolicyVersion: "final-readiness-required-draft-v1",
        runId: finalReadinessRun.id,
        tenderId: tender.id,
        tenderVersionId: tenderVersion.id,
      },
    });
  await database.finalReadinessSnapshotDocument.create({
    data: {
      checksum: tenderDocument.sha256,
      role: "PRIMARY",
      snapshotId: finalReadinessSnapshot.id,
      sourceIdentifier: "PRIMARY:tender-source.pdf",
      tenderDocumentId: tenderDocument.id,
    },
  });
  await database.finalReadinessSnapshotRequiredDraft.create({
    data: {
      draftCreatorUserId: draftCreator.id,
      draftId: draft.id,
      draftType: "CONSOLIDATED_FIRST_DRAFT",
      draftVersionId: draftVersion.id,
      generationRunId: draftGenerationRun.id,
      inputSnapshotId: draftInputSnapshot.id,
      qualifyingReviewEventId: draftReviewEvent.id,
      snapshotId: finalReadinessSnapshot.id,
      sourceFingerprint: SOURCE_FINGERPRINT,
      templateVersionId: draftTemplateVersion.id,
    },
  });
  const finalReadinessFinding = await database.finalReadinessFinding.create({
    data: {
      explanation:
        "Controlled review remains distinct from external submission and requires an independent approver.",
      findingOrder: 1,
      lifecycle: "OPEN",
      materiality: "NON_MATERIAL",
      organisationId: organisation.id,
      provenanceValid: true,
      reviewState: "REVIEWED",
      ruleCode: "PHASE13_CONTROLLED_REVIEW_WARNING",
      runId: finalReadinessRun.id,
      tenderId: tender.id,
      title: "Controlled review warning",
      treatment: "WARNING",
    },
  });
  await database.finalReadinessFindingProvenance.create({
    data: {
      findingId: finalReadinessFinding.id,
      kind: "RISK_FINDING",
      riskFindingId: finalRiskFinding.id,
    },
  });
  await database.finalReadinessDecision.create({
    data: {
      actorRoleAtDecision: "REVIEWER",
      actorUserId: reviewer.id,
      disposition: "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
      organisationId: organisation.id,
      rationale: "Proceed to controlled export review for Phase 13 validation.",
      runFingerprint: READINESS_FINGERPRINT,
      runId: finalReadinessRun.id,
      tenderId: tender.id,
    },
  });
  await database.tenderVersion.update({
    data: { activeFinalReadinessRunId: finalReadinessRun.id },
    where: { id: tenderVersion.id },
  });

  const exportTemplate = await database.exportTemplate.create({
    data: {
      key: `phase13-template-${tag}`,
      name: "Phase 13 export template",
    },
  });
  const exportTemplateVersion = await database.exportTemplateVersion.create({
    data: {
      approvedAt: FIXTURE_NOW,
      layout: {
        disclaimers: ["Human review required", "Not approved for submission"],
        pageNumbering: true,
      },
      sourceFingerprint: SOURCE_FINGERPRINT,
      templateId: exportTemplate.id,
      templatePolicyVersion: "controlled-review-package-template-v1",
      versionNumber: 1,
    },
  });
  await database.exportTemplate.update({
    data: { activeVersionId: exportTemplateVersion.id },
    where: { id: exportTemplate.id },
  });

  return {
    organisationId: organisation.id,
    tenderId: tender.id,
    tenderVersionId: tenderVersion.id,
    users: {
      admin: userInfo(admin),
      consultant: userInfo(consultant),
      crossTenant: userInfo(crossTenant),
      draftCreator: userInfo(draftCreator),
      owner: userInfo(owner),
      platformAdmin: userInfo(platformAdmin),
      reviewer: userInfo(reviewer),
      tenderExecutive: userInfo(tenderExecutive),
    },
  };
}

function userInfo(user: { displayName: string; email: string }): FixtureUser {
  return { displayName: user.displayName, email: user.email };
}

async function loginAs(
  browser: Browser,
  user: FixtureUser,
  viewport: { readonly width: number; readonly height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport,
  });
  const page = await context.newPage();
  await page.goto("/login");
  const passwordInput = page.locator("#auth-password");
  const togglePassword = page.getByRole("button", { name: "Show password" });
  await togglePassword.click();
  await expect(passwordInput).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(passwordInput).toHaveAttribute("type", "password");
  await page.getByLabel("Email address").fill(user.email);
  await passwordInput.fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
  return { context, page };
}

async function navigateToExport(page: Page, data: FixtureData): Promise<void> {
  await page.goto(
    `/tenders/${data.organisationId}/${data.tenderId}?stage=export`,
  );
}

function captureBrowserQuality(page: Page): {
  readonly errors: string[];
  readonly failedRequests: string[];
} {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() !== "error") return;
    if (/favicon|next start does not work with output: standalone/iu.test(text))
      return;
    errors.push(text);
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (/favicon.ico$/u.test(url)) return;
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${request.method()} ${url}`);
  });
  return { errors, failedRequests };
}

async function assertSeededGoldenWorkflowState(): Promise<void> {
  const tender = await prisma.tender.findUniqueOrThrow({
    include: {
      currentVersion: true,
      organisation: true,
      workspace: true,
    },
    where: { id: fixture.tenderId },
  });
  const documents = await prisma.tenderDocument.findMany({
    where: { tenderVersionId: fixture.tenderVersionId },
  });
  expect(tender.organisationId).toBe(fixture.organisationId);
  expect(tender.workspace?.sourceSectionStatus).toBe("READY");
  expect(documents).toEqual([
    expect.objectContaining({
      organisationId: fixture.organisationId,
      status: "READY",
    }),
  ]);
  expect(tender.currentVersion?.activeExtractionRunId).toEqual(
    expect.any(String),
  );
  expect(tender.currentVersion?.activeEarlyRiskRunId).toEqual(
    expect.any(String),
  );
  expect(tender.currentVersion?.activeEligibilityAssessmentRunId).toEqual(
    expect.any(String),
  );
  expect(tender.currentVersion?.activeFinalReadinessRunId).toEqual(
    expect.any(String),
  );

  await expect
    .poll(async () =>
      prisma.extractedUnit.count({
        where: {
          extractionRunId: tender.currentVersion?.activeExtractionRunId ?? "",
          ocrStatus: { in: ["NOT_REQUIRED", "OCR_PERFORMED"] },
        },
      }),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      prisma.extractionCitation.count({
        where: {
          extractionRunId: tender.currentVersion?.activeExtractionRunId ?? "",
          validationStatus: "VALIDATED",
        },
      }),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      prisma.riskAnalysisRun.count({
        where: {
          gateType: "EARLY",
          organisationId: fixture.organisationId,
          status: "COMPLETE",
          tenderId: fixture.tenderId,
        },
      }),
    )
    .toBe(1);
  await expect
    .poll(async () =>
      prisma.earlyPursuitDecision.count({
        where: {
          decision: "CONTINUE",
          organisationId: fixture.organisationId,
          tenderId: fixture.tenderId,
        },
      }),
    )
    .toBe(1);
  await expect
    .poll(async () =>
      prisma.eligibilityAssessment.count({
        where: {
          assessmentRunId:
            tender.currentVersion?.activeEligibilityAssessmentRunId ?? "",
          reviewState: "FINALISED",
          tenderId: fixture.tenderId,
        },
      }),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      prisma.checklistGenerationRun.count({
        where: {
          organisationId: fixture.organisationId,
          status: "COMPLETE",
          tenderId: fixture.tenderId,
        },
      }),
    )
    .toBe(1);
  await expect
    .poll(async () =>
      prisma.ragIndexRun.count({
        where: {
          activatedAt: { not: null },
          organisationId: fixture.organisationId,
          status: "COMPLETE",
          tenderId: fixture.tenderId,
        },
      }),
    )
    .toBe(1);
  await expect
    .poll(async () =>
      prisma.draftVersion.count({
        where: {
          organisationId: fixture.organisationId,
          reviewState: "APPROVED",
          tenderId: fixture.tenderId,
        },
      }),
    )
    .toBe(1);
  await expect
    .poll(async () =>
      prisma.finalReadinessDecision.count({
        where: {
          disposition: "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
          organisationId: fixture.organisationId,
          tenderId: fixture.tenderId,
        },
      }),
    )
    .toBe(1);
}

async function assertWorkspaceStages(
  page: Page,
  data: FixtureData,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /Phase 13 Controlled Package/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Extraction" }).click();
  await expect(page).toHaveURL(/stage=extraction/u);
  await expect(page.getByRole("heading", { name: "Extraction" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Valid GST registration" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Risks" }).click();
  await expect(page.getByRole("heading", { name: "Risks" })).toBeVisible();
  await expect(
    page.getByText("Registration evidence remains relevant"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Evidence" }).click();
  await expect(
    page.getByRole("heading", { name: "Evidence matrix" }),
  ).toBeVisible();
  await expect(page.getByText(/Valid GST registration/u)).toBeVisible();

  await page.getByRole("button", { name: "Checklist" }).click();
  await expect(
    page.getByRole("heading", { name: "Missing documents and actions" }),
  ).toBeVisible();
  await expect(page.getByText("Confirm GST evidence")).toBeVisible();

  await page.getByRole("button", { name: "Ask" }).click();
  await expect(
    page.getByRole("heading", { name: "Cited tender chatbot" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Answers are limited to authorised tender and evidence/u),
  ).toBeVisible();

  await page.getByRole("button", { name: "Draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Version 1 · Approved" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Approved fixture draft text for controlled review/u),
  ).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Readiness" }).click();
  await expect(
    page.getByRole("heading", { name: "Final readiness review" }),
  ).toBeVisible();
  await expect(page.getByText(/Current .* Completed/u)).toBeVisible();
  await expect(
    page.getByText("Proceed to controlled export review"),
  ).toBeVisible();

  await page.goto(
    `/tenders/${data.organisationId}/${data.tenderId}?stage=export`,
  );
}

async function waitForGeneratedRun(previousCount: number) {
  await expect
    .poll(
      async () => {
        const runs = await prisma.controlledReviewPackageRun.findMany({
          orderBy: { createdAt: "desc" },
          where: { tenderId: fixture.tenderId },
        });
        const latest = runs[0];
        return {
          count: runs.length,
          id: latest?.id ?? null,
          status: latest?.generationStatus ?? null,
        };
      },
      { timeout: REQUEST_TIMEOUT_MS },
    )
    .toMatchObject({
      count: previousCount + 1,
      status: "GENERATED",
    });

  const latest = await prisma.controlledReviewPackageRun.findFirstOrThrow({
    orderBy: { createdAt: "desc" },
    where: { tenderId: fixture.tenderId },
  });
  return latest;
}

async function latestRunReviewStatus(runId: string): Promise<string | null> {
  const run = await prisma.controlledReviewPackageRun.findUnique({
    select: { reviewStatus: true },
    where: { id: runId },
  });
  return run?.reviewStatus ?? null;
}

async function downloadCurrentPackage(page: Page): Promise<{
  downloadedPath: string;
}> {
  await page.reload();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Authorise one-minute download" })
    .click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  return { downloadedPath: downloadedPath! };
}

function inspectControlledPackageZip(download: { downloadedPath: string }) {
  const bytes = readFileSync(download.downloadedPath);
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  expect(names).toEqual([
    "review.pdf",
    "manifest.json",
    "SHA256SUMS.txt",
    "provenance-index.json",
  ]);

  const manifest = JSON.parse(
    Buffer.from(entries["manifest.json"] ?? []).toString("utf8"),
  ) as {
    readonly members: readonly {
      readonly byte_size: number;
      readonly kind: string;
      readonly logical_path: string;
      readonly mime_type: string;
      readonly sha256?: string;
    }[];
    readonly package_id: string;
  };
  expect(manifest.package_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(manifest.members.map((member) => member.logical_path)).toEqual(names);

  const provenance = JSON.parse(
    Buffer.from(entries["provenance-index.json"] ?? []).toString("utf8"),
  ) as {
    readonly items: readonly {
      readonly handle: string;
      readonly record_id: string;
    }[];
    readonly package_id: string;
  };
  expect(provenance.items.length).toBeGreaterThan(0);
  expect(JSON.stringify(provenance)).not.toMatch(
    /signed[_-]?url|credential|secret|privateObjectKey|approvedObjectKey/iu,
  );

  const pdfBytes = entries["review.pdf"] ?? new Uint8Array();
  const checksums = Buffer.from(entries["SHA256SUMS.txt"] ?? []).toString(
    "utf8",
  );
  const pdfSha256 = sha256(pdfBytes);
  expect(checksums).toContain(`${pdfSha256}  review.pdf`);
  expect(checksums).toContain(
    `${sha256(entries["provenance-index.json"] ?? new Uint8Array())}  provenance-index.json`,
  );

  const pdfText = Buffer.from(pdfBytes).toString("latin1");
  expect(pdfText).not.toMatch(
    /\/JavaScript|\/JS\b|\/Launch|\/AcroForm|\/EmbeddedFiles|\/Filespec|\/URI\b/u,
  );
  expect(pdfText).not.toMatch(/secret|credential|signedurl|localpath/iu);

  return {
    downloadedPath: download.downloadedPath,
    pdfSha256,
    zipSha256: sha256(bytes),
  };
}

async function waitForHttpReady(url: string): Promise<void> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry until the service is ready.
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
