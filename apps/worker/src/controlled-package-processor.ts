/* eslint-disable @typescript-eslint/explicit-function-return-type -- Prisma relation payloads are intentionally inferred for the immutable snapshot loader. */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Prisma, type PrismaClient } from "@tender/database";
import {
  controlledPackageEmbeddedManifestSchema,
  controlledPackageProvenanceIndexSchema,
  type ControlledPackageEmbeddedManifest,
} from "@tender/contracts";
import { createHash, randomUUID } from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { MalwareScanner } from "./malware-scanner.js";
import {
  CONTROLLED_PACKAGE_RENDERER_VERSION,
  renderControlledPackagePdf,
  type ControlledPackageRenderItem,
} from "./controlled-package-renderer.js";

export interface ControlledPackageJob {
  readonly controlledReviewPackageRunId: string;
  readonly organisationId: string;
  readonly requestId: string;
}

export function isControlledPackageJob(
  value: unknown,
): value is ControlledPackageJob {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") ===
      "controlledReviewPackageRunId,organisationId,requestId" &&
    [
      record.controlledReviewPackageRunId,
      record.organisationId,
      record.requestId,
    ].every((item) => typeof item === "string" && item.length > 0)
  );
}

const MEMBER_NAMES = [
  "review.pdf",
  "manifest.json",
  "SHA256SUMS.txt",
  "provenance-index.json",
] as const;
const ZIP_LIMIT = 100 * 1024 * 1024;
const MEMBER_LIMIT = 50 * 1024 * 1024;

export class ControlledPackageProcessor {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: S3Client,
    private readonly bucket: string,
    private readonly scanner: MalwareScanner,
  ) {}

  async process(
    job: ControlledPackageJob,
    signal?: AbortSignal,
  ): Promise<void> {
    const leased = await this.database.controlledReviewPackageRun.updateMany({
      data: {
        generationStatus: "PROCESSING",
        startedAt: new Date(),
        safeFailureCode: null,
      },
      where: {
        id: job.controlledReviewPackageRunId,
        organisationId: job.organisationId,
        generationStatus: "QUEUED",
        cancellationRequestedAt: null,
        invalidatedAt: null,
      },
    });
    if (leased.count === 0) return;
    let temporaryKey: string | undefined;
    let finalKey: string | undefined;
    try {
      signal?.throwIfAborted();
      const authority = await this.loadAuthority(job);
      if (authority === null || !this.isCurrent(authority)) {
        await this.invalidate(job);
        return;
      }
      if (await this.cancelled(job)) {
        await this.cancel(job);
        return;
      }
      const model = await this.buildRenderModel(authority);
      const pdf = await renderControlledPackagePdf(model);
      if (await this.cancelled(job)) {
        await this.cancel(job);
        return;
      }
      const provenance = canonicalJson({
        items: authority.inputSnapshot.provenance.map((item) => ({
          handle: item.safeHandle,
          record_id: provenanceRecordId(item),
          type: item.kind,
        })),
        package_id: authority.id,
      });
      controlledPackageProvenanceIndexSchema.parse(JSON.parse(provenance));
      const pdfBytes = pdf.bytes;
      const provenanceBytes = strToU8(provenance);
      const checksumsBytes = strToU8(
        `${sha256(pdfBytes)}  review.pdf\n${sha256(provenanceBytes)}  provenance-index.json\n`,
      );
      const logicalContentFingerprint = sha256(
        strToU8(
          canonicalJson({
            inputFingerprint: authority.inputFingerprint,
            pdf: sha256(pdfBytes),
            provenance: sha256(provenanceBytes),
          }),
        ),
      );
      const embedded = buildEmbeddedManifest(
        authority,
        logicalContentFingerprint,
        pdfBytes,
        provenanceBytes,
        checksumsBytes,
      );
      controlledPackageEmbeddedManifestSchema.parse(embedded);
      const manifestBytes = serialiseEmbeddedManifest(embedded);
      const zipBytes = createDeterministicZip(
        {
          "review.pdf": pdfBytes,
          "manifest.json": manifestBytes,
          "SHA256SUMS.txt": checksumsBytes,
          "provenance-index.json": provenanceBytes,
        },
        authority.inputSnapshot.canonicalRenderTimestamp,
      );
      validateControlledPackageZip(zipBytes);
      if (await this.cancelled(job)) {
        await this.cancel(job);
        return;
      }
      temporaryKey = `controlled-packages/${job.organisationId}/${authority.id}/tmp/${randomUUID()}`;
      finalKey = `controlled-packages/${job.organisationId}/${authority.id}/artifact/${randomUUID()}`;
      await this.storage.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: temporaryKey,
          Body: zipBytes,
          ContentType: "application/zip",
          Metadata: { sha256: sha256(zipBytes) },
        }),
      );
      const temporaryHead = await this.storage.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: temporaryKey }),
      );
      if (
        temporaryHead.ContentLength !== zipBytes.byteLength ||
        temporaryHead.ContentType !== "application/zip" ||
        temporaryHead.Metadata?.sha256 !== sha256(zipBytes)
      )
        throw new WorkerFailure("CONTROLLED_PACKAGE_UPLOAD_INTEGRITY_FAILED");
      if (await this.cancelled(job)) {
        await this.deleteObject(temporaryKey);
        await this.cancel(job);
        return;
      }
      const scan = await this.scanner.scan(zipBytes);
      if (scan.status !== "CLEAN")
        throw new WorkerFailure(
          scan.status === "INFECTED"
            ? "CONTROLLED_PACKAGE_MALWARE_DETECTED"
            : "CONTROLLED_PACKAGE_SCANNER_UNAVAILABLE",
        );
      if (
        !(await this.isStillCurrent(job, authority.inputFingerprint)) ||
        (await this.cancelled(job))
      ) {
        await this.deleteObject(temporaryKey);
        await this.invalidate(job);
        return;
      }
      await this.storage.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${temporaryKey}`,
          Key: finalKey,
          MetadataDirective: "COPY",
        }),
      );
      const finalHead = await this.storage.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: finalKey }),
      );
      if (
        finalHead.ContentLength !== zipBytes.byteLength ||
        finalHead.Metadata?.sha256 !== sha256(zipBytes)
      )
        throw new WorkerFailure(
          "CONTROLLED_PACKAGE_PROMOTION_INTEGRITY_FAILED",
        );
      await this.activate(
        authority,
        finalKey,
        zipBytes,
        logicalContentFingerprint,
        [
          member("REVIEW_PDF", "review.pdf", "application/pdf", pdfBytes),
          member(
            "MANIFEST_JSON",
            "manifest.json",
            "application/json",
            manifestBytes,
          ),
          member(
            "CHECKSUMS_TEXT",
            "SHA256SUMS.txt",
            "text/plain",
            checksumsBytes,
          ),
          member(
            "PROVENANCE_INDEX_JSON",
            "provenance-index.json",
            "application/json",
            provenanceBytes,
          ),
        ],
      );
      await this.deleteObject(temporaryKey);
    } catch (error) {
      if (temporaryKey !== undefined) await this.deleteObject(temporaryKey);
      if (finalKey !== undefined) await this.deleteObject(finalKey);
      await this.fail(job, safeFailureCode(error));
      throw error;
    }
  }

  private loadAuthority(job: ControlledPackageJob) {
    return this.database.controlledReviewPackageRun.findFirst({
      include: {
        inputSnapshot: { include: { documents: true, provenance: true } },
        templateVersion: true,
        tender: { select: { title: true } },
        tenderVersion: { select: { activeFinalReadinessRunId: true } },
      },
      where: {
        id: job.controlledReviewPackageRunId,
        organisationId: job.organisationId,
        generationStatus: "PROCESSING",
      },
    });
  }
  private isCurrent(run: LoadedAuthority): run is CurrentAuthority {
    return (
      run.inputSnapshot !== null &&
      run.inputFingerprint === run.inputSnapshot.inputFingerprint &&
      run.rendererCompatibilityVersion ===
        CONTROLLED_PACKAGE_RENDERER_VERSION &&
      run.tenderVersion.activeFinalReadinessRunId ===
        run.inputSnapshot.finalReadinessRunId &&
      run.templateVersion.approvedAt !== null &&
      run.templateVersion.retiredAt === null
    );
  }
  private async isStillCurrent(
    job: ControlledPackageJob,
    fingerprint: string,
  ): Promise<boolean> {
    const run = await this.database.controlledReviewPackageRun.findFirst({
      select: {
        generationStatus: true,
        inputFingerprint: true,
        invalidatedAt: true,
      },
      where: {
        id: job.controlledReviewPackageRunId,
        organisationId: job.organisationId,
      },
    });
    return (
      run?.generationStatus === "PROCESSING" &&
      run.invalidatedAt === null &&
      run.inputFingerprint === fingerprint
    );
  }
  private buildRenderModel(run: CurrentAuthority) {
    return Promise.all([
      this.database.draftVersion.findFirst({
        include: { sections: { orderBy: { sectionOrder: "asc" } } },
        where: {
          id: run.inputSnapshot.draftVersionId,
          organisationId: run.organisationId,
          tenderId: run.tenderId,
        },
      }),
      this.database.finalReadinessFinding.findMany({
        orderBy: { findingOrder: "asc" },
        where: {
          runId: run.inputSnapshot.finalReadinessRunId,
          organisationId: run.organisationId,
        },
      }),
      this.database.riskFinding.findMany({
        orderBy: { id: "asc" },
        where: {
          riskAnalysisRunId: run.inputSnapshot.finalRiskRunId,
          organisationId: run.organisationId,
        },
      }),
      this.database.checklistItem.findMany({
        orderBy: { id: "asc" },
        where: {
          generationRunId: run.inputSnapshot.checklistGenerationRunId,
          organisationId: run.organisationId,
        },
      }),
    ]).then(([draft, readiness, risks, checklist]) => {
      if (draft === null || draft.sections.length === 0)
        throw new WorkerFailure("CONTROLLED_PACKAGE_SNAPSHOT_INCOMPLETE");
      const handles = run.inputSnapshot.provenance
        .map(({ safeHandle }) => safeHandle)
        .sort();
      const item = (
        title: string,
        text: string,
      ): ControlledPackageRenderItem => ({
        provenanceHandles: handles,
        text,
        title,
      });
      return {
        canonicalRenderTimestamp:
          run.inputSnapshot.canonicalRenderTimestamp.toISOString(),
        checklist: checklist.map((row) =>
          item(
            row.currentTitle,
            row.currentDescription ?? row.proposedExplanation,
          ),
        ),
        draftSections: draft.sections.map(({ content, heading }) => ({
          heading,
          text: content,
        })),
        finalReadinessFindings: readiness.map((finding) =>
          item(finding.title, finding.explanation),
        ),
        finalRiskFindings: risks.map((finding) =>
          item(finding.title, finding.explanation),
        ),
        packageId: run.id,
        packageTitle: run.tender.title,
        policyVersion: "controlled-review-package-deterministic-v1" as const,
        provenanceHandles: handles,
        rendererCompatibilityVersion: CONTROLLED_PACKAGE_RENDERER_VERSION,
        tenderIdentifiers: [run.tenderId, run.tenderVersionId],
        warnings: readiness
          .filter(({ treatment }) => treatment === "WARNING")
          .map((finding) => item(finding.title, finding.explanation)),
      };
    });
  }
  private async activate(
    run: CurrentAuthority,
    key: string,
    zip: Uint8Array,
    fingerprint: string,
    members: ReturnType<typeof member>[],
  ): Promise<void> {
    await this.database.$transaction(
      async (tx) => {
        const updated = await tx.controlledReviewPackageRun.updateMany({
          data: {
            generatedAt: run.inputSnapshot.canonicalRenderTimestamp,
            generationStatus: "GENERATED",
            logicalContentFingerprint: fingerprint,
          },
          where: {
            id: run.id,
            organisationId: run.organisationId,
            generationStatus: "PROCESSING",
            cancellationRequestedAt: null,
            invalidatedAt: null,
            inputFingerprint: run.inputFingerprint,
            artifacts: { none: {} },
            manifest: null,
          },
        });
        if (updated.count !== 1)
          throw new WorkerFailure("CONTROLLED_PACKAGE_ACTIVATION_CONFLICT");
        await tx.packageArtifact.create({
          data: {
            byteSize: BigInt(zip.byteLength),
            integrityVerifiedAt: new Date(),
            kind: "PACKAGE_ZIP",
            malwareStatus: "CLEAN",
            mimeType: "application/zip",
            organisationId: run.organisationId,
            privateObjectKey: key,
            promotedAt: new Date(),
            promotionStatus: "PROMOTED",
            runId: run.id,
            safeFilename: `controlled-review-package-${run.id}.zip`,
            sha256: sha256(zip),
            tenderId: run.tenderId,
          },
        });
        await tx.packageManifest.create({
          data: {
            generatedAt: run.inputSnapshot.canonicalRenderTimestamp,
            logicalContentFingerprint: fingerprint,
            organisationId: run.organisationId,
            runId: run.id,
            schemaVersion: "controlled-review-package-manifest-v1",
            tenderId: run.tenderId,
            members: {
              create: members.map((value) => ({
                ...value,
                byteSize: BigInt(value.byteSize),
              })),
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  private async cancelled(job: ControlledPackageJob): Promise<boolean> {
    return (
      (await this.database.controlledReviewPackageRun.count({
        where: {
          id: job.controlledReviewPackageRunId,
          organisationId: job.organisationId,
          cancellationRequestedAt: { not: null },
        },
      })) > 0
    );
  }
  private async cancel(job: ControlledPackageJob): Promise<void> {
    await this.database.controlledReviewPackageRun.updateMany({
      data: { cancelledAt: new Date(), generationStatus: "CANCELLED" },
      where: {
        id: job.controlledReviewPackageRunId,
        organisationId: job.organisationId,
        generationStatus: "PROCESSING",
      },
    });
  }
  private async invalidate(job: ControlledPackageJob): Promise<void> {
    await this.database.controlledReviewPackageRun.updateMany({
      data: {
        generationStatus: "INVALIDATED",
        invalidatedAt: new Date(),
        safeFailureCode: "CONTROLLED_PACKAGE_PREREQUISITES_NOT_CURRENT",
      },
      where: {
        id: job.controlledReviewPackageRunId,
        organisationId: job.organisationId,
        generationStatus: "PROCESSING",
      },
    });
  }
  private async fail(job: ControlledPackageJob, code: string): Promise<void> {
    await this.database.controlledReviewPackageRun.updateMany({
      data: {
        failedAt: new Date(),
        generationStatus: "FAILED",
        safeFailureCode: code,
      },
      where: {
        id: job.controlledReviewPackageRunId,
        organisationId: job.organisationId,
        generationStatus: "PROCESSING",
      },
    });
  }
  private async deleteObject(key: string): Promise<void> {
    await this.storage
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch(() => undefined);
  }
}

type LoadedAuthority = NonNullable<
  Awaited<ReturnType<ControlledPackageProcessor["loadAuthority"]>>
>;
type CurrentAuthority = LoadedAuthority & {
  inputSnapshot: NonNullable<LoadedAuthority["inputSnapshot"]>;
};
class WorkerFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ControlledPackageWorkerFailure";
  }
}
function safeFailureCode(error: unknown): string {
  return error instanceof WorkerFailure
    ? error.code
    : error instanceof Error &&
        "code" in error &&
        typeof error.code === "string"
      ? error.code
      : "CONTROLLED_PACKAGE_GENERATION_FAILED";
}
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value))}\n`;
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  return value;
}
function provenanceRecordId(item: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(item))
    if (key.endsWith("Id") && key !== "snapshotId" && typeof value === "string")
      return value;
  throw new WorkerFailure("CONTROLLED_PACKAGE_SNAPSHOT_INCOMPLETE");
}
function member(
  kind:
    "REVIEW_PDF" | "MANIFEST_JSON" | "CHECKSUMS_TEXT" | "PROVENANCE_INDEX_JSON",
  logicalPath: string,
  mimeType: string,
  bytes: Uint8Array,
) {
  return {
    byteSize: bytes.byteLength,
    kind,
    logicalPath,
    mimeType,
    sha256: sha256(bytes),
  };
}
function buildEmbeddedManifest(
  run: CurrentAuthority,
  fingerprint: string,
  pdf: Uint8Array,
  provenance: Uint8Array,
  checksums: Uint8Array,
): ControlledPackageEmbeddedManifest {
  return {
    generated_at: run.inputSnapshot.canonicalRenderTimestamp.toISOString(),
    generation_policy_version: "controlled-review-package-deterministic-v1",
    logical_content_fingerprint: fingerprint,
    members: [
      {
        byte_size: pdf.byteLength,
        kind: "REVIEW_PDF",
        logical_path: "review.pdf",
        mime_type: "application/pdf",
        sha256: sha256(pdf),
      },
      {
        byte_size: 0,
        kind: "MANIFEST_JSON",
        logical_path: "manifest.json",
        mime_type: "application/json",
      },
      {
        byte_size: checksums.byteLength,
        kind: "CHECKSUMS_TEXT",
        logical_path: "SHA256SUMS.txt",
        mime_type: "text/plain",
        sha256: sha256(checksums),
      },
      {
        byte_size: provenance.byteLength,
        kind: "PROVENANCE_INDEX_JSON",
        logical_path: "provenance-index.json",
        mime_type: "application/json",
        sha256: sha256(provenance),
      },
    ],
    organisation_id: run.organisationId,
    package_id: run.id,
    phase_11_decision_id: run.inputSnapshot.finalReadinessDecisionId,
    phase_11_readiness_run_id: run.inputSnapshot.finalReadinessRunId,
    renderer_compatibility_version: CONTROLLED_PACKAGE_RENDERER_VERSION,
    schema_version: "controlled-review-package-embedded-manifest-v1",
    template_version_id: run.templateVersionId,
    tender_id: run.tenderId,
    tender_version_id: run.tenderVersionId,
    warnings: [],
  };
}
export function createDeterministicZip(
  files: Record<(typeof MEMBER_NAMES)[number], Uint8Array>,
  timestamp: Date,
): Uint8Array {
  const mtime = new Date(Math.max(timestamp.valueOf(), Date.UTC(1980, 0, 1)));
  return zipSync(
    Object.fromEntries(
      MEMBER_NAMES.map((name) => [name, [files[name], { level: 6, mtime }]]),
    ),
    { level: 6, mtime },
  );
}
export function validateControlledPackageZip(bytes: Uint8Array): void {
  if (bytes.byteLength > ZIP_LIMIT)
    throw new WorkerFailure("CONTROLLED_PACKAGE_SIZE_LIMIT_EXCEEDED");
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  if (
    names.length !== 4 ||
    names.some((name, index) => name !== MEMBER_NAMES[index]) ||
    names.some(
      (name) =>
        name.includes("/") ||
        name.includes("\\") ||
        entries[name]!.byteLength > MEMBER_LIMIT,
    )
  )
    throw new WorkerFailure("CONTROLLED_PACKAGE_ARCHIVE_INVALID");
  if (
    !Buffer.from(entries["review.pdf"]!)
      .subarray(0, 5)
      .equals(Buffer.from("%PDF-"))
  )
    throw new WorkerFailure("CONTROLLED_PACKAGE_ARCHIVE_INVALID");
  const pdf = entries["review.pdf"]!;
  const manifestBytes = entries["manifest.json"]!;
  const checksums = entries["SHA256SUMS.txt"]!;
  const provenance = entries["provenance-index.json"]!;
  const manifest = controlledPackageEmbeddedManifestSchema.parse(
    JSON.parse(Buffer.from(manifestBytes).toString("utf8")),
  );
  controlledPackageProvenanceIndexSchema.parse(
    JSON.parse(Buffer.from(provenance).toString("utf8")),
  );
  const expectedChecksums = `${sha256(pdf)}  review.pdf\n${sha256(provenance)}  provenance-index.json\n`;
  if (Buffer.from(checksums).toString("utf8") !== expectedChecksums)
    throw new WorkerFailure("CONTROLLED_PACKAGE_CHECKSUM_MISMATCH");
  const memberBytes = new Map<string, Uint8Array>([
    ["review.pdf", pdf],
    ["manifest.json", manifestBytes],
    ["SHA256SUMS.txt", checksums],
    ["provenance-index.json", provenance],
  ]);
  for (const declared of manifest.members) {
    const actual = memberBytes.get(declared.logical_path);
    if (
      actual?.byteLength !== declared.byte_size ||
      ("sha256" in declared && sha256(actual) !== declared.sha256)
    )
      throw new WorkerFailure("CONTROLLED_PACKAGE_CHECKSUM_MISMATCH");
    if (
      declared.kind !== "REVIEW_PDF" &&
      Buffer.from(actual).subarray(0, 4).equals(Buffer.from("PK\u0003\u0004"))
    )
      throw new WorkerFailure("CONTROLLED_PACKAGE_ARCHIVE_INVALID");
  }
  if (
    /\/JavaScript|\/JS\b|\/Launch|\/AcroForm|\/EmbeddedFiles|\/Filespec|\/URI\b/u.test(
      Buffer.from(pdf).toString("latin1"),
    )
  )
    throw new WorkerFailure("CONTROLLED_PACKAGE_UNSAFE_PDF");
}

function serialiseEmbeddedManifest(
  initial: ControlledPackageEmbeddedManifest,
): Uint8Array {
  let manifest = initial;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = strToU8(canonicalJson(manifest));
    const declared = manifest.members.find(
      ({ kind }) => kind === "MANIFEST_JSON",
    );
    if (declared?.byte_size === bytes.byteLength) return bytes;
    manifest = controlledPackageEmbeddedManifestSchema.parse({
      ...manifest,
      members: manifest.members.map((member) =>
        member.kind === "MANIFEST_JSON"
          ? { ...member, byte_size: bytes.byteLength }
          : member,
      ),
    });
  }
  throw new WorkerFailure("CONTROLLED_PACKAGE_MANIFEST_UNSTABLE");
}
