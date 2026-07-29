import { describe, expect, it } from "vitest";
import {
  createCompanyCitationSchema,
  createEvidenceFactSchema,
} from "./evidence-assessment.js";

describe("evidence contracts", () => {
  it("requires exactly one typed fact value", () => {
    const base = {
      document_id: "4c99417e-e20b-4b9f-a4d7-f948423972dc",
      document_version_id: "60ed3b2a-e3bb-46ae-b8ab-c11473426b56",
      fact_type: "GST_IDENTIFIER",
    };
    expect(
      createEvidenceFactSchema.safeParse({
        ...base,
        value: { text_value: "value", value_type: "IDENTIFIER" },
      }).success,
    ).toBe(true);
    expect(
      createEvidenceFactSchema.safeParse({
        ...base,
        value: {
          number_value: 1,
          text_value: "value",
          value_type: "IDENTIFIER",
        },
      }).success,
    ).toBe(false);
  });

  it("does not fabricate source coordinates", () => {
    const citation = {
      bounded_excerpt: "Human-captured bounded source excerpt.",
      document_id: "4c99417e-e20b-4b9f-a4d7-f948423972dc",
      document_version_id: "60ed3b2a-e3bb-46ae-b8ab-c11473426b56",
    };
    const parsed = createCompanyCitationSchema.parse(citation);
    expect(parsed.page_number).toBeUndefined();
    expect(
      createCompanyCitationSchema.safeParse({
        ...citation,
        sheet_name: "Sheet1",
      }).success,
    ).toBe(false);
  });
});
