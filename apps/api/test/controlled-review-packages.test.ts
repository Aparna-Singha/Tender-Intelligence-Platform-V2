import { NotFoundException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ControlledReviewPackageController } from "../src/controlled-review-packages/controlled-review-package.controller.js";
import { ControlledReviewPackageFreshnessService } from "../src/controlled-review-packages/controlled-review-package-freshness.service.js";
import { ControlledReviewPackageService } from "../src/controlled-review-packages/controlled-review-package.service.js";

describe("Phase 12 controlled review-package API boundaries", () => {
  it("does not reveal a cross-tenant package run", async () => {
    const database = {
      controlledReviewPackageRun: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new ControlledReviewPackageService(
      database as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.detail("organisation-b", "tender-a", "run-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.controlledReviewPackageRun.findFirst).toHaveBeenCalledWith({
      where: {
        id: "run-a",
        organisationId: "organisation-b",
        tenderId: "tender-a",
      },
    });
  });

  it("replays equivalent idempotency without dispatching another job", async () => {
    const existing = {
      createdAt: new Date("2026-08-04T12:00:00.000Z"),
      generationStatus: "QUEUED",
      id: "run-a",
      inputFingerprint: "a".repeat(64),
    };
    const database = {
      controlledReviewPackageRun: {
        findFirst: vi.fn().mockResolvedValue(existing),
      },
    };
    const jobs = { add: vi.fn() };
    const freshness = { evaluate: vi.fn().mockResolvedValue({ fresh: true }) };
    const service = new ControlledReviewPackageService(
      database as never,
      jobs as never,
      freshness as never,
    );
    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "user-a",
        "key-12345",
        "request-a",
      ),
    ).resolves.toMatchObject({ package_id: "run-a", status: "QUEUED" });
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("uses serializable persistence, opaque queue data, and the locked renderer contract", () => {
    const source = readFileSync(
      new URL(
        "../src/controlled-review-packages/controlled-review-package.service.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("TransactionIsolationLevel.Serializable");
    expect(source).toContain(
      "CONTROLLED_REVIEW_PACKAGE_RENDERER_COMPATIBILITY_VERSION",
    );
    expect(source).toContain('"generate-controlled-review-package"');
    const queueCall = source.slice(
      source.indexOf("await this.jobs.add"),
      source.indexOf("removeOnComplete", source.indexOf("await this.jobs.add")),
    );
    expect(queueCall).toContain("controlledReviewPackageRunId");
    expect(queueCall).toContain("organisationId");
    expect(queueCall).toContain("requestId");
    for (const prohibited of [
      "actor",
      "role",
      "membership",
      "snapshot",
      "document",
      "draft",
      "evidence",
      "fingerprint",
      "objectKey",
      "signedUrl",
      "prompt",
      "credential",
    ])
      expect(queueCall.toLowerCase()).not.toContain(prohibited.toLowerCase());
  });

  it("registers explicit permissions and no storage or submission routes", () => {
    const source = readFileSync(
      new URL(
        "../src/controlled-review-packages/controlled-review-package.controller.ts",
        import.meta.url,
      ),
      "utf8",
    );
    for (const permission of [
      "TENDER_CONTROLLED_PACKAGE_PREFLIGHT",
      "TENDER_CONTROLLED_PACKAGE_READ",
      "TENDER_CONTROLLED_PACKAGE_MANIFEST_READ",
      "TENDER_CONTROLLED_PACKAGE_START",
      "TENDER_CONTROLLED_PACKAGE_CANCEL",
      "TENDER_CONTROLLED_PACKAGE_RETRY",
      "TENDER_CONTROLLED_PACKAGE_REVIEW",
      "TENDER_CONTROLLED_PACKAGE_APPROVE",
      "TENDER_CONTROLLED_PACKAGE_DOWNLOAD",
      "TENDER_CONTROLLED_PACKAGE_REVOKE",
      "TENDER_CONTROLLED_PACKAGE_AUDIT_READ",
    ])
      expect(source).toContain(permission);
    expect(source).toContain("request.authenticatedUser.userId");
    expect(source).toContain("request.organisationPrincipal.role");
    expect(source).not.toMatch(/signed|presigned/i);
    expect(source).not.toContain('Post("submission');
  });

  it("strict request parsing rejects browser-supplied authority", () => {
    const controller = new ControlledReviewPackageController({} as never);
    expect(() =>
      controller.start(
        "organisation-a",
        "tender-a",
        {
          idempotency_key: "package-123",
          renderer_compatibility_version: "override",
        },
        {} as never,
      ),
    ).toThrow();
  });
});

describe("Phase 12 controlled-package freshness", () => {
  it("fails closed when the immutable snapshot is missing", async () => {
    const freshness = new ControlledReviewPackageFreshnessService({
      controlledReviewPackageRun: {
        findFirst: vi.fn().mockResolvedValue({ inputSnapshot: null }),
      },
    } as never);
    await expect(
      freshness.evaluate("organisation-a", "tender-a", "run-a"),
    ).resolves.toEqual({
      fresh: false,
      freshness: "INVALIDATED",
      reasons: ["SNAPSHOT_MISSING"],
    });
  });
});
