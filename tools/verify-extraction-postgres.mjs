import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createPrismaClient } from "../packages/database/dist/index.js";
import { ExtractionProcessor } from "../apps/worker/dist/extraction-processor.js";
import { ExtractionsService } from "../apps/api/dist/extractions/extractions.service.js";

const target = process.env.BIDVEDA_EXTRACTION_TEST_DATABASE_URL;
if (!target) throw new Error("Dedicated test database URL is required");
let url;
try {
  url = new URL(target);
} catch {
  throw new Error("Dedicated test database URL is invalid");
}
if (
  url.protocol !== "postgresql:" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "16432" ||
  url.pathname !== "/bidveda_pr47_verification" ||
  decodeURIComponent(url.username) !== "pr47_test" ||
  url.search !== "" ||
  url.hash !== ""
)
  throw new Error(
    "Database target is not the dedicated PR47 PostgreSQL database",
  );

const prisma = createPrismaClient(target);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const fixtureTag = randomUUID();
let ordinal = 0;
const timestamps = Date.now();
const report = {
  fixture: "NOT_RUN",
  performance: [],
  rollback: [],
  concurrency: [],
};

function parsedDocument(document, pageCount, blocksPerPage, options = {}) {
  const units = Array.from({ length: pageCount }, (_, page) => ({
    blocks: Array.from({ length: blocksPerPage }, (_, index) => {
      const text =
        page === 0 && index === 0 && options.primary
          ? "Buyer: Synthetic purchaser. Bidder shall submit GST certificate."
          : `Bidder shall submit synthetic ${options.label ?? "document"} certificate ${page}-${index}.`;
      const table =
        options.boq && page === 0 && index === 0
          ? {
              columnCount: 2,
              rowCount: 18,
              cells: Array.from({ length: 18 }, (_, rowIndex) => [
                {
                  rowIndex,
                  columnIndex: 0,
                  displayedValue: `Synthetic line ${rowIndex + 1}`,
                },
                {
                  rowIndex,
                  columnIndex: 1,
                  displayedValue: String(rowIndex + 1),
                },
              ]).flat(),
            }
          : undefined;
      return {
        confidence: "HIGH",
        readingOrder: index,
        sourceEndOffset: text.length,
        sourceStartOffset: 0,
        ...(table ? { table } : {}),
        text,
        type: "PARAGRAPH",
        warnings: [],
      };
    }),
    characterCount: blocksPerPage * 65,
    confidence: "HIGH",
    ocrStatus: options.scanned ? "OCR_PERFORMED" : "NOT_REQUIRED",
    unitIndex: page + 1,
    unitType: options.boq ? "SHEET" : "PAGE",
  }));
  return {
    document,
    parsed: {
      format: options.boq ? "CSV" : "PDF",
      issues: [],
      parserName: "pr47-synthetic-parser",
      parserVersion: "1",
      units,
    },
  };
}

function instrument({ failAt = null, latencyMs = 0 } = {}) {
  const metrics = {
    operations: 0,
    batches: 0,
    rows: {},
    maxBatch: 0,
    transactionMs: 0,
    lastOperation: "none",
  };
  const client = {
    $transaction: (callback, options) =>
      prisma.$transaction(async (tx) => {
        const started = performance.now();
        const wrapped = new Proxy(tx, {
          get(target, model) {
            if (model === "$queryRaw")
              return (...args) => {
                metrics.operations++;
                metrics.lastOperation = "advisory-lock";
                return target.$queryRaw(...args);
              };
            const delegate = target[model];
            if (
              typeof model !== "string" ||
              delegate === undefined ||
              delegate === null
            )
              return delegate;
            return new Proxy(delegate, {
              get(object, method) {
                const original = object[method];
                if (typeof original !== "function") return original;
                return async (...args) => {
                  metrics.operations++;
                  const label = `${model}.${String(method)}`;
                  metrics.lastOperation = label;
                  if (label === failAt)
                    throw new Error("INJECTED_PERSISTENCE_FAILURE");
                  if (method === "createMany") {
                    const count = args[0]?.data?.length ?? 0;
                    metrics.batches++;
                    metrics.rows[model] = (metrics.rows[model] ?? 0) + count;
                    metrics.maxBatch = Math.max(metrics.maxBatch, count);
                  }
                  if (latencyMs > 0)
                    await new Promise((resolve) =>
                      setTimeout(resolve, latencyMs),
                    );
                  return original.call(object, ...args);
                };
              },
            });
          },
        });
        try {
          return await callback(wrapped);
        } finally {
          metrics.transactionMs = performance.now() - started;
        }
      }, options),
  };
  return { client, metrics };
}

async function newRun(context, status = "STRUCTURING") {
  ordinal++;
  return prisma.extractionRun.create({
    data: {
      organisationId: context.organisation.id,
      tenderId: context.tender.id,
      tenderVersionId: context.version.id,
      status,
      triggerType: ordinal === 1 ? "USER" : "RETRY",
      parserPolicyVersion: "deterministic-v1",
      structuringPolicyVersion: "rules-v4",
      idempotencyKey: `pr47-${fixtureTag}-${ordinal}`,
      sourceFingerprint: sha(`pr47-${fixtureTag}-${ordinal}`),
      requestedByUserId: context.user.id,
      createdAt: new Date(timestamps + ordinal * 1000),
    },
  });
}

async function persist(run, context, options = {}) {
  const { client, metrics } = instrument(options);
  const processor = new ExtractionProcessor(
    client,
    {},
    "synthetic-unused-bucket",
  );
  const started = performance.now();
  try {
    await processor.persist(run.id, context.version.id, context.sources);
    return { metrics, totalMs: performance.now() - started };
  } catch (error) {
    error.metrics = metrics;
    throw error;
  }
}

async function counts(runId) {
  const names = [
    "extractionRunDocument",
    "extractedUnit",
    "extractedBlock",
    "extractedTable",
    "extractedTableCell",
    "classifiedSection",
    "extractedTenderField",
    "structuredRequirement",
    "extractionCitation",
    "extractionIssue",
  ];
  const result = {};
  for (const name of names) {
    if (name === "extractedTableCell") {
      result[name] = await prisma.extractedTableCell.count({
        where: { extractedTable: { extractionRunId: runId } },
      });
    } else {
      result[name] = await prisma[name].count({
        where: { extractionRunId: runId },
      });
    }
  }
  return result;
}

async function verifyPersisted(run, context, metrics) {
  const data = await prisma.extractionRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  const version = await prisma.tenderVersion.findUniqueOrThrow({
    where: { id: context.version.id },
  });
  const table = await counts(run.id);
  assert.equal(data.status, "COMPLETE");
  assert.equal(version.activeExtractionRunId, run.id);
  assert.equal(table.extractionRunDocument, 4);
  assert.equal(table.extractedUnit, 29);
  assert.ok(table.extractedBlock >= 620);
  assert.ok(table.structuredRequirement >= 620);
  assert.equal(table.extractedTable, 1);
  assert.equal(table.extractedTableCell, 36);
  assert.equal(
    table.extractionCitation,
    table.structuredRequirement + table.extractedTenderField,
  );
  assert.equal(
    data.qualitySummary.documents_processed,
    table.extractionRunDocument,
  );
  assert.equal(data.qualitySummary.units_processed, table.extractedUnit);
  assert.equal(
    data.qualitySummary.requirements_extracted,
    table.structuredRequirement,
  );
  assert.equal(
    data.qualitySummary.fields_extracted,
    table.extractedTenderField,
  );
  assert.equal(data.qualitySummary.ocr_pages_attempted, 3);
  assert.equal(data.qualitySummary.ocr_pages_succeeded, 3);
  assert.ok(metrics.maxBatch <= 200);
  assert.ok(metrics.transactionMs < 120000);
  const citations = await prisma.extractionCitation.findMany({
    where: { extractionRunId: run.id },
    select: {
      extractionRunDocumentId: true,
      tenderDocumentId: true,
      extractedUnitId: true,
      extractedBlockId: true,
      structuredRequirementId: true,
      extractedTenderFieldId: true,
      sourceChecksum: true,
    },
  });
  const documents = await prisma.extractionRunDocument.findMany({
    where: { extractionRunId: run.id },
    select: { id: true, tenderDocumentId: true },
  });
  const units = await prisma.extractedUnit.findMany({
    where: { extractionRunId: run.id },
    select: { id: true, extractionRunDocumentId: true },
  });
  const blocks = await prisma.extractedBlock.findMany({
    where: { extractionRunId: run.id },
    select: { id: true, extractedUnitId: true },
  });
  const docById = new Map(documents.map((item) => [item.id, item]));
  const unitById = new Map(units.map((item) => [item.id, item]));
  const blockById = new Map(blocks.map((item) => [item.id, item]));
  const sourceById = new Map(
    context.sources.map((item) => [item.document.id, item]),
  );
  for (const citation of citations) {
    const document = docById.get(citation.extractionRunDocumentId);
    assert.equal(document?.tenderDocumentId, citation.tenderDocumentId);
    assert.equal(
      unitById.get(citation.extractedUnitId)?.extractionRunDocumentId,
      document.id,
    );
    assert.equal(
      blockById.get(citation.extractedBlockId)?.extractedUnitId,
      citation.extractedUnitId,
    );
    assert.equal(
      sourceById.get(citation.tenderDocumentId)?.document.sha256,
      citation.sourceChecksum,
    );
    assert.equal(
      Number(Boolean(citation.structuredRequirementId)) +
        Number(Boolean(citation.extractedTenderFieldId)),
      1,
    );
  }
  const invalidLinks = await prisma.$queryRaw`
    SELECT count(*)::int AS count
    FROM extraction_citations c
    LEFT JOIN extraction_run_documents d ON d.id = c.extraction_run_document_id
    LEFT JOIN extracted_units u ON u.id = c.extracted_unit_id
    LEFT JOIN extracted_blocks b ON b.id = c.extracted_block_id
    WHERE c.extraction_run_id = ${run.id}::uuid
      AND (d.id IS NULL OR d.tender_document_id <> c.tender_document_id
        OR u.id IS NULL OR u.extraction_run_document_id <> d.id
        OR b.id IS NULL OR b.extracted_unit_id <> u.id)
  `;
  assert.equal(invalidLinks[0]?.count, 0);
  return table;
}

async function main() {
  const migrations =
    await prisma.$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(migrations[0]?.count, 18);
  const failed =
    await prisma.$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  assert.equal(failed[0]?.count, 0);
  const unvalidated = await prisma.$queryRaw`
    SELECT count(*)::int AS count FROM pg_constraint
    WHERE contype = 'f' AND NOT convalidated
  `;
  assert.equal(unvalidated[0]?.count, 0);
  const user = await prisma.user.create({
    data: {
      email: `pr47-${fixtureTag}@example.invalid`,
      passwordHash: "synthetic-no-login",
      displayName: "PR47 synthetic",
    },
  });
  const organisation = await prisma.organisation.create({
    data: {
      name: `PR47 synthetic ${fixtureTag}`,
      type: "MSME",
      createdByUserId: user.id,
    },
  });
  await prisma.organisationMembership.create({
    data: { organisationId: organisation.id, userId: user.id, role: "OWNER" },
  });
  const tender = await prisma.tender.create({
    data: {
      organisationId: organisation.id,
      title: "Synthetic four document tender",
      buyer: "Synthetic buyer",
      submissionDeadline: new Date("2027-12-31T12:00:00Z"),
      sourceType: "MANUAL_UPLOAD",
      lifecycleStatus: "SOURCE_READY",
      createdByUserId: user.id,
    },
  });
  const version = await prisma.tenderVersion.create({
    data: {
      tenderId: tender.id,
      versionNumber: 1,
      reason: "Synthetic PostgreSQL verification",
      sourceSnapshot: {},
      sourceFingerprint: sha(fixtureTag),
      sourceProvenance: "synthetic-test",
      createdByUserId: user.id,
    },
  });
  await prisma.tender.update({
    where: { id: tender.id },
    data: { currentVersionId: version.id },
  });
  const documentDefinitions = [
    [
      "primary",
      "PRIMARY",
      ".pdf",
      "application/pdf",
      24,
      20,
      { primary: true, label: "primary" },
    ],
    ["boq", "BOQ", ".csv", "text/csv", 1, 18, { boq: true, label: "BOQ" }],
    [
      "terms",
      "ANNEXURE",
      ".pdf",
      "application/pdf",
      3,
      40,
      { scanned: true, label: "terms" },
    ],
    [
      "technical",
      "TECHNICAL_SPECIFICATION",
      ".pdf",
      "application/pdf",
      1,
      40,
      { label: "technical" },
    ],
  ];
  const sources = [];
  for (const [
    name,
    role,
    extension,
    mime,
    pages,
    blocksPerPage,
    options,
  ] of documentDefinitions) {
    const checksum = sha(`${fixtureTag}-${name}`);
    const document = await prisma.tenderDocument.create({
      data: {
        organisationId: organisation.id,
        tenderVersionId: version.id,
        role,
        originalFilename: `${name}${extension}`,
        displayFilename: `${name}${extension}`,
        declaredMimeType: mime,
        detectedMimeType: mime,
        extension,
        sizeBytes: 1000n,
        sha256: checksum,
        quarantineObjectKey: `pr47/${fixtureTag}/quarantine/${name}`,
        approvedObjectKey: `pr47/${fixtureTag}/approved/${name}`,
        status: "READY",
        provenance: "synthetic-test",
        uploadedByUserId: user.id,
        uploadSessionExpiresAt: new Date("2027-12-31T12:00:00Z"),
      },
    });
    sources.push(parsedDocument(document, pages, blocksPerPage, options));
  }
  const context = { user, organisation, tender, version, sources };
  report.fixture = "PASS";
  const baseline = await newRun(context);
  const normal = await persist(baseline, context);
  const baselineCounts = await verifyPersisted(
    baseline,
    context,
    normal.metrics,
  );
  const risk = await prisma.riskAnalysisRun.create({
    data: {
      organisationId: organisation.id,
      tenderId: tender.id,
      tenderVersionId: version.id,
      extractionRunId: baseline.id,
      gateType: "EARLY",
      status: "COMPLETE",
      triggerType: "USER",
      riskPolicyVersion: "synthetic-v1",
      sourceFingerprint: sha(`risk-${fixtureTag}`),
      idempotencyKey: `pr47-risk-${fixtureTag}`,
      requestedByUserId: user.id,
    },
  });
  await prisma.tenderVersion.update({
    where: { id: version.id },
    data: { activeEarlyRiskRunId: risk.id },
  });
  report.performance.push({
    case: "representative",
    totalMs: Math.round(normal.totalMs),
    transactionMs: Math.round(normal.metrics.transactionMs),
    operations: normal.metrics.operations,
    batches: normal.metrics.batches,
    maxBatch: normal.metrics.maxBatch,
    inserted: baselineCounts,
  });
  for (const failAt of [
    "extractedUnit.createMany",
    "extractedBlock.createMany",
    "structuredRequirement.createMany",
    "extractionCitation.createMany",
    "tenderVersion.update",
  ]) {
    const run = await newRun(context);
    let failedAsExpected = false;
    try {
      await persist(run, context, { failAt });
    } catch (error) {
      failedAsExpected = error.message === "INJECTED_PERSISTENCE_FAILURE";
    }
    assert.ok(
      failedAsExpected,
      `Failure injection did not trigger at ${failAt}`,
    );
    const table = await counts(run.id);
    assert.ok(
      Object.values(table).every((count) => count === 0),
      `Partial rows committed after ${failAt}`,
    );
    assert.equal(
      (
        await prisma.tenderVersion.findUniqueOrThrow({
          where: { id: version.id },
        })
      ).activeExtractionRunId,
      baseline.id,
    );
    assert.equal(
      (
        await prisma.tenderVersion.findUniqueOrThrow({
          where: { id: version.id },
        })
      ).activeEarlyRiskRunId,
      risk.id,
    );
    assert.equal(
      (
        await prisma.extractionRun.findUniqueOrThrow({
          where: { id: baseline.id },
        })
      ).status,
      "COMPLETE",
    );
    await prisma.extractionRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        currentStage: "FAILED",
        failureCategory: "SYNTHETIC_FAILURE",
      },
    });
    report.rollback.push({ stage: failAt, result: "PASS" });
  }
  const retry = await newRun(context);
  const recovered = await persist(retry, context);
  await verifyPersisted(retry, context, recovered.metrics);
  assert.equal(
    (await prisma.riskAnalysisRun.findUniqueOrThrow({ where: { id: risk.id } }))
      .status,
    "INVALIDATED",
  );
  assert.equal(
    (
      await prisma.tenderVersion.findUniqueOrThrow({
        where: { id: version.id },
      })
    ).activeEarlyRiskRunId,
    null,
  );
  report.performance.push({
    case: "retry",
    totalMs: Math.round(recovered.totalMs),
    transactionMs: Math.round(recovered.metrics.transactionMs),
    operations: recovered.metrics.operations,
    batches: recovered.metrics.batches,
    maxBatch: recovered.metrics.maxBatch,
  });
  assert.equal(
    (
      await prisma.extractionRun.findUniqueOrThrow({
        where: { id: baseline.id },
      })
    ).status,
    "COMPLETE",
  );
  const latencyRun = await newRun(context);
  const delayed = await persist(latencyRun, context, { latencyMs: 50 });
  await verifyPersisted(latencyRun, context, delayed.metrics);
  report.performance.push({
    case: "50ms-per-operation",
    totalMs: Math.round(delayed.totalMs),
    transactionMs: Math.round(delayed.metrics.transactionMs),
    operations: delayed.metrics.operations,
    batches: delayed.metrics.batches,
    maxBatch: delayed.metrics.maxBatch,
  });
  const stale = await newRun(context);
  await prisma.extractionRun.update({
    where: { id: stale.id },
    data: { cancellationRequestedAt: new Date() },
  });
  await assert.rejects(
    persist(stale, context),
    (error) => error.code === "STALE_EXTRACTION_RUN",
  );
  assert.ok(
    Object.values(await counts(stale.id)).every((count) => count === 0),
  );
  report.concurrency.push({ case: "cancel-before-activation", result: "PASS" });
  const concurrent = await newRun(context);
  const workers = await Promise.allSettled([
    persist(concurrent, context),
    persist(concurrent, context),
  ]);
  assert.equal(workers.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(
    workers.filter(
      (item) =>
        item.status === "rejected" &&
        item.reason?.code === "STALE_EXTRACTION_RUN",
    ).length,
    1,
  );
  assert.equal(
    (
      await prisma.tenderVersion.findUniqueOrThrow({
        where: { id: version.id },
      })
    ).activeExtractionRunId,
    concurrent.id,
  );
  report.concurrency.push({ case: "two-workers-one-run", result: "PASS" });
  await assert.rejects(
    persist(retry, context),
    (error) => error.code === "STALE_EXTRACTION_RUN",
  );
  assert.equal(
    (
      await prisma.tenderVersion.findUniqueOrThrow({
        where: { id: version.id },
      })
    ).activeExtractionRunId,
    concurrent.id,
  );
  report.concurrency.push({ case: "older-worker-after-newer", result: "PASS" });
  const calls = [];
  let failNext = false;
  const queue = {
    add: async (_name, _data, options) => {
      if (failNext) {
        failNext = false;
        throw new Error("INJECTED_QUEUE_FAILURE");
      }
      calls.push(options.jobId);
    },
  };
  const service = new ExtractionsService(prisma, queue);
  const start = (key) =>
    service.start(
      organisation.id,
      tender.id,
      version.id,
      user.id,
      key,
      randomUUID(),
      "RETRY",
    );
  const sameKey = `same-${randomUUID()}`;
  const [firstStart, secondStart] = await Promise.all([
    start(sameKey),
    start(sameKey),
  ]);
  assert.equal(firstStart.id, secondStart.id);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((id) => id === firstStart.id));
  report.concurrency.push({ case: "two-starts-same-key", result: "PASS" });
  await prisma.extractionRun.update({
    where: { id: firstStart.id },
    data: { status: "FAILED", currentStage: "FAILED" },
  });
  calls.length = 0;
  const [differentA, differentB] = await Promise.all([
    start(`different-a-${randomUUID()}`),
    start(`different-b-${randomUUID()}`),
  ]);
  assert.equal(differentA.id, differentB.id);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((id) => id === differentA.id));
  report.concurrency.push({
    case: "two-starts-equivalent-source",
    result: "PASS",
  });
  await prisma.extractionRun.update({
    where: { id: differentA.id },
    data: { status: "FAILED", currentStage: "FAILED" },
  });
  failNext = true;
  const recoveryKey = `queue-recovery-${randomUUID()}`;
  await assert.rejects(start(recoveryKey), /INJECTED_QUEUE_FAILURE/);
  const queued = await prisma.extractionRun.findFirstOrThrow({
    where: { tenderVersionId: version.id, status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  const replayed = await start(recoveryKey);
  assert.equal(replayed.id, queued.id);
  assert.equal(calls.at(-1), queued.id);
  report.concurrency.push({ case: "queue-failure-replay", result: "PASS" });
  await prisma.extractionRun.update({
    where: { id: queued.id },
    data: { status: "FAILED", currentStage: "FAILED" },
  });
  const retried = await service.retry(
    organisation.id,
    tender.id,
    queued.id,
    user.id,
    `intentional-${randomUUID()}`,
    randomUUID(),
  );
  assert.notEqual(retried.id, queued.id);
  assert.equal(retried.status, "QUEUED");
  assert.equal(
    (await prisma.extractionRun.findUniqueOrThrow({ where: { id: queued.id } }))
      .status,
    "FAILED",
  );
  report.concurrency.push({
    case: "intentional-failed-run-retry",
    result: "PASS",
  });
}

try {
  await main();
  console.log(JSON.stringify({ result: "PASS", ...report }));
} catch (error) {
  console.error(
    JSON.stringify({
      result: "FAIL",
      stage: report.fixture === "PASS" ? "persistence-verification" : "fixture",
      code: /^P\d{4}$/.test(error?.code ?? "")
        ? error.code
        : "ASSERTION_OR_DATABASE_FAILURE",
      dbCode: /^[0-9A-Z]{5}$/.test(error?.meta?.code ?? "")
        ? error.meta.code
        : null,
      lastOperation: error?.metrics?.lastOperation ?? "none",
      ...report,
    }),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
