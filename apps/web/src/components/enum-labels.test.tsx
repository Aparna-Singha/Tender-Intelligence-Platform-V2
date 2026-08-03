import { describe, expect, it } from "vitest";
import { humanizeEnum } from "@tender/ui";

describe("human-readable enum labels", () => {
  it("keeps backend values unchanged while presenting readable labels", () => {
    expect(humanizeEnum("PRIVATE_LIMITED")).toBe("Private limited company");
    expect(humanizeEnum("TENDER_EXECUTIVE")).toBe("Tender executive");
    expect(humanizeEnum("HUMAN_REVIEW_REQUIRED")).toBe("Human review required");
    expect(humanizeEnum("OEM_AUTHORISATION")).toBe("OEM authorisation");
    expect(humanizeEnum("500_PLUS")).toBe("More than 500 employees");
    expect(humanizeEnum("NOT_BLACKLISTED")).toBe("Not blacklisted");
    expect(humanizeEnum("CONTINUE")).toBe("Continue");
  });
});
