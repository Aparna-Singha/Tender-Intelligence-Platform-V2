import { NotFoundException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DraftsService } from "../src/drafts/drafts.service.js";

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
});
