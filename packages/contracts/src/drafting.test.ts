import { describe, expect, it } from "vitest";
import {
  createDraftHumanInputSchema,
  createDraftTemplateVersionSchema,
  editDraftVersionSchema,
  resolveDraftPlaceholderSchema,
  startDraftGenerationSchema,
} from "./drafting.js";

describe("drafting contracts", () => {
  it("rejects browser-provided authority identifiers", () => {
    expect(() =>
      startDraftGenerationSchema.parse({
        draft_type: "CONSOLIDATED_FIRST_DRAFT",
        idempotency_key: "aaaaaaaa",
        organisation_id: crypto.randomUUID(),
        source_mode: "TENDER_ONLY",
        template_version_id: crypto.randomUUID(),
        title: "First draft",
      }),
    ).toThrow();
  });

  it("bounds drafting instructions and edited section bodies", () => {
    expect(() =>
      startDraftGenerationSchema.parse({
        draft_type: "CONSOLIDATED_FIRST_DRAFT",
        idempotency_key: "aaaaaaaa",
        instructions: "x".repeat(2_001),
        template_version_id: crypto.randomUUID(),
        title: "First draft",
      }),
    ).toThrow();
    expect(() =>
      editDraftVersionSchema.parse({
        change_summary: "Reviewed technical wording",
        sections: [
          { content: "x".repeat(12_001), section_key: "technical-response" },
        ],
      }),
    ).toThrow();
  });

  it("requires a source to resolve a placeholder", () => {
    expect(() =>
      resolveDraftPlaceholderSchema.parse({
        rationale: "The supporting source has been reviewed.",
      }),
    ).toThrow();
  });

  it("does not treat human inputs as unstructured authority", () => {
    expect(() =>
      createDraftHumanInputSchema.parse({
        input_class: "DELIVERY_COMMITMENT",
        organisation_id: crypto.randomUUID(),
        provenance_description: "Authorised internal delivery decision",
        value: "Delivery within the specified period",
      }),
    ).toThrow();
  });

  it("rejects executable template guidance", () => {
    expect(() =>
      createDraftTemplateVersionSchema.parse({
        required_review_role: "REVIEWER",
        sections: [
          {
            allowed_claim_classes: ["TENDER_SOURCE_STATEMENT"],
            formatting_guidance: "<script>unsafe()</script>",
            heading: "Response",
            key: "response",
            order: 0,
            required_source_classes: [],
          },
        ],
      }),
    ).toThrow();
  });
});
