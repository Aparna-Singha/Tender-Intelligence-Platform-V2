import { NotFoundException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  draftRetryIdempotencyKey,
  DraftsService,
} from "../src/drafts/drafts.service.js";

describe("Phase 10 draft tenant boundaries", () => {
  it("does not reveal another organisation's draft", async () => {
    const database = {
      draft: { findFirst: vi.fn().mockResolvedValue(null) },
      draftVersion: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new DraftsService(
      database as never,
      {} as never,
      {
        DRAFT_MODEL: "gemini-2.5-flash",
        DRAFT_PROVIDER: "gemini",
        GEMINI_API_KEY: "safe-test-value",
      } as never,
    );

    await expect(
      service.draft("organisation-b", "tender-a", "draft-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.draft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          id: "draft-a",
          organisationId: "organisation-b",
          tenderId: "tender-a",
        },
      }),
    );
  });

  it("keeps browser identifiers out of draft authority inputs", () => {
    const controller = readFileSync(
      new URL("../src/drafts/drafts.controller.ts", import.meta.url),
      "utf8",
    );
    expect(controller).toContain("request.auth");
    expect(controller).not.toContain("body.organisation_id");
    expect(controller).not.toContain("body.user_id");
    expect(controller).not.toContain("body.profile_id");
  });

  it("uses explicit draft permissions and never adds an export route", () => {
    const controller = readFileSync(
      new URL("../src/drafts/drafts.controller.ts", import.meta.url),
      "utf8",
    );
    expect(controller).toContain("TENDER_DRAFT_GENERATE");
    expect(controller).toContain("TENDER_DRAFT_APPROVE");
    expect(controller).not.toContain('@Post("export');
    expect(controller).not.toContain('@Post("submit');
  });

  it("takes review authority from membership and persists role-at-action", () => {
    const controller = readFileSync(
      new URL("../src/drafts/drafts.controller.ts", import.meta.url),
      "utf8",
    );
    const service = readFileSync(
      new URL("../src/drafts/drafts.service.ts", import.meta.url),
      "utf8",
    );
    expect(controller).toContain("request.organisationPrincipal.role");
    expect(controller).not.toContain("body.actorRole");
    expect(service).toContain("template?.requiredReviewRole !== actorRole");
    expect(service).toContain("actorRoleAtAction: actorRole");
    expect(service).toContain("versionCreatorUserId: version.createdByUserId");
  });

  it("keeps retry idempotency keys bounded across repeated retries", () => {
    const key = draftRetryIdempotencyKey(
      "753bd923-63e7-4cbb-ae29-4e746baadd4d",
      "e2883d70-4a0f-4481-be8b-0c1dd505d8da",
      "78fa3cf4-1c1e-4396-be42-adfb10dd1f4d",
    );

    expect(key).toBe(
      "753bd923-63e7-4cbb-ae29-4e746baadd4d:e2883d70-4a0f-4481-be8b-0c1dd505d8da:retry:78fa3cf4-1c1e-4396-be42-adfb10dd1f4d",
    );
    expect(key.length).toBeLessThanOrEqual(255);
  });

  it("leaves transient provider retries to the provider adapter instead of multiplying whole jobs", () => {
    const service = readFileSync(
      new URL("../src/drafts/drafts.service.ts", import.meta.url),
      "utf8",
    );
    const draftJobs = service.match(
      /"generate-fact-constrained-draft"[\s\S]{0,500}?attempts: 1/g,
    );

    expect(draftJobs).toHaveLength(2);
  });
});
