const { sign } = vi.hoisted(() => ({
  sign: vi.fn().mockResolvedValue("https://private.example/signed"),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: sign }));

import type { GetObjectCommand } from "@aws-sdk/client-s3";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DocumentsService } from "../src/documents/documents.service.js";
import { RequirementEvidenceController } from "../src/eligibility/requirement-evidence.controller.js";
import { RequirementEvidenceService } from "../src/eligibility/requirement-evidence.service.js";
import { ACCESS_POLICY } from "../src/common/access-control.js";

const ids = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  tenderId: "22222222-2222-4222-8222-222222222222",
  versionId: "33333333-3333-4333-8333-333333333333",
  requirementId: "44444444-4444-4444-8444-444444444444",
  attachmentId: "55555555-5555-4555-8555-555555555555",
};
const scope = {
  organisationId: ids.organisationId,
  tenderId: ids.tenderId,
  tenderVersionId: ids.versionId,
  requirementId: ids.requirementId,
};

describe("requirement attachment download", () => {
  it("signs the attached historical version and restricts organisation, tender, requirement and library scope", async () => {
    const attachment = {
      documentId: "document-a",
      documentVersion: {
        id: "historical-v1",
        approvedObjectKey: "approved/v1",
        versionNumber: 1,
        extension: ".pdf",
      },
    };
    const database = {
      requirementEvidenceAttachment: {
        findFirst: vi.fn().mockResolvedValue(attachment),
      },
      documentAccessEvent: { create: vi.fn().mockResolvedValue(undefined) },
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
    };
    const service = new DocumentsService(
      database as never,
      {} as never,
      {} as never,
      {
        S3_BUCKET: "private",
        DOCUMENT_DOWNLOAD_TTL_SECONDS: 60,
      } as never,
    );
    await expect(
      service.downloadRequirementAttachment(
        scope,
        ids.attachmentId,
        "reviewer",
        "request",
      ),
    ).resolves.toMatchObject({
      document_version_id: "historical-v1",
      expires_in_seconds: 60,
    });
    expect(
      database.requirementEvidenceAttachment.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ids.attachmentId,
          organisationId: ids.organisationId,
          tenderId: ids.tenderId,
          tenderVersionId: ids.versionId,
          structuredRequirementId: ids.requirementId,
          document: {
            deletedAt: null,
            organisationId: ids.organisationId,
            OR: [{ tenderScopeId: null }, { tenderScopeId: ids.tenderId }],
          },
        }),
      }),
    );
    expect((sign.mock.calls.at(-1)?.[1] as GetObjectCommand).input.Key).toBe(
      "approved/v1",
    );
    database.requirementEvidenceAttachment.findFirst.mockResolvedValueOnce(
      null,
    );
    await expect(
      service.downloadRequirementAttachment(
        scope,
        ids.attachmentId,
        "reviewer",
        "request",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("requires reviewer permissions before invoking the scoped service", () => {
    const evidence = { downloadAttachment: vi.fn() };
    const controller = new RequirementEvidenceController(evidence as never);
    expect(() =>
      controller.download(ids, {
        organisationPrincipal: null,
        authenticatedUser: { userId: "reviewer" },
        id: "request",
      } as never),
    ).toThrow(ForbiddenException);
    expect(evidence.downloadAttachment).not.toHaveBeenCalled();
    const downloadHandler = Object.getOwnPropertyDescriptor(
      RequirementEvidenceController.prototype,
      "download",
    )?.value as object | undefined;
    if (!downloadHandler) throw new Error("Download handler is missing");
    expect(Reflect.getMetadata(ACCESS_POLICY, downloadHandler)).toEqual({
      kind: "organisation",
      permission: "DOCUMENT_READ",
    });
  });

  it("denies a mismatched requirement before requesting a signed URL", async () => {
    const documents = { downloadRequirementAttachment: vi.fn() };
    const database = {
      structuredRequirement: { findFirst: vi.fn().mockResolvedValue(null) },
      tenderVersion: { findFirst: vi.fn() },
    };
    const service = new RequirementEvidenceService(
      database as never,
      documents as never,
    );
    await expect(
      service.downloadAttachment(
        scope,
        ids.attachmentId,
        "reviewer",
        "request",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(documents.downloadRequirementAttachment).not.toHaveBeenCalled();
    expect(database.tenderVersion.findFirst).not.toHaveBeenCalled();
  });
});
