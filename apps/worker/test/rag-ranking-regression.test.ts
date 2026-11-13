import { describe, expect, it } from "vitest";

type Topic = "documents" | "eligibility" | "risks" | "summary" | "missing";
type QuestionTopic = Topic | "exemptions" | "unsupported";
type SourceClass =
  | "TENDER_PRIMARY"
  | "STRUCTURED_REQUIREMENT"
  | "STRUCTURED_FIELD"
  | "TENDER_METADATA"
  | "SYSTEM_POLICY";

interface SyntheticChunk {
  readonly id: string;
  readonly sourceClass: SourceClass;
  readonly topic: Topic;
  readonly hasValidCitation: boolean;
}

const chunks: readonly SyntheticChunk[] = [
  ...(["documents", "eligibility", "risks"] as const).flatMap((topic) =>
    Array.from({ length: 5 }, (_, index) => ({
      id: `primary-${topic}-${index}`,
      sourceClass: "TENDER_PRIMARY" as const,
      topic,
      hasValidCitation: true,
    })),
  ),
  ...(["documents", "eligibility", "risks"] as const).flatMap((topic) =>
    Array.from({ length: 4 }, (_, index) => ({
      id: `requirement-${topic}-${index}`,
      sourceClass: "STRUCTURED_REQUIREMENT" as const,
      topic,
      hasValidCitation: true,
    })),
  ),
  {
    id: "requirement-eligibility-exemption",
    sourceClass: "STRUCTURED_REQUIREMENT",
    topic: "eligibility",
    hasValidCitation: true,
  },
  ...Array.from({ length: 3 }, (_, index) => ({
    id: `field-${index}`,
    sourceClass: "STRUCTURED_FIELD" as const,
    topic: "summary" as const,
    hasValidCitation: true,
  })),
  {
    id: "metadata",
    sourceClass: "TENDER_METADATA",
    topic: "summary",
    hasValidCitation: true,
  },
  {
    id: "policy",
    sourceClass: "SYSTEM_POLICY",
    topic: "missing",
    hasValidCitation: false,
  },
];

function selectContext(
  topic: QuestionTopic,
  priorClassPriority: boolean,
): readonly SyntheticChunk[] {
  const scored = chunks.map((chunk) => ({
    ...chunk,
    lexicalScore:
      chunk.topic === topic ||
      (topic === "exemptions" &&
        chunk.id === "requirement-eligibility-exemption")
        ? 1
        : 0,
    vectorScore:
      chunk.topic !== topic &&
      !(
        topic === "exemptions" &&
        chunk.id === "requirement-eligibility-exemption"
      )
        ? 0
        : chunk.sourceClass === "STRUCTURED_REQUIREMENT"
          ? 0.97
          : chunk.sourceClass === "STRUCTURED_FIELD"
            ? 0.92
            : 1,
  }));
  const lexical = [...scored].sort(
    (left, right) =>
      right.lexicalScore - left.lexicalScore || left.id.localeCompare(right.id),
  );
  const vector = [...scored].sort(
    (left, right) =>
      right.vectorScore - left.vectorScore || left.id.localeCompare(right.id),
  );
  const rank = (
    ordered: typeof scored,
    score: "lexicalScore" | "vectorScore",
    chunk: SyntheticChunk,
  ): number => {
    const position = ordered.findIndex((item) => item.id === chunk.id);
    return priorClassPriority
      ? position + 1
      : ordered.findIndex(
          (item) => item[score] === ordered[position]?.[score],
        ) + 1;
  };
  const priority = (sourceClass: SourceClass): number =>
    sourceClass === "TENDER_METADATA"
      ? 0
      : sourceClass === "STRUCTURED_FIELD"
        ? 1
        : 2;
  return scored
    .map((chunk) => ({
      ...chunk,
      fusedScore:
        1 / (60 + rank(lexical, "lexicalScore", chunk)) +
        1 / (60 + rank(vector, "vectorScore", chunk)),
      lexicalPosition: lexical.findIndex((item) => item.id === chunk.id) + 1,
      vectorPosition: vector.findIndex((item) => item.id === chunk.id) + 1,
    }))
    .filter(
      (chunk) => chunk.lexicalPosition <= 40 || chunk.vectorPosition <= 40,
    )
    .sort(
      (left, right) =>
        (priorClassPriority
          ? priority(left.sourceClass) - priority(right.sourceClass)
          : 0) ||
        right.fusedScore - left.fusedScore ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 8);
}

describe("synthetic 33-chunk tender retrieval", () => {
  it("matches the independently observed source-class distribution", () => {
    expect(chunks).toHaveLength(33);
    expect(
      Object.fromEntries(
        (
          [
            "TENDER_PRIMARY",
            "STRUCTURED_REQUIREMENT",
            "STRUCTURED_FIELD",
            "TENDER_METADATA",
            "SYSTEM_POLICY",
          ] as const
        ).map((sourceClass) => [
          sourceClass,
          chunks.filter((chunk) => chunk.sourceClass === sourceClass).length,
        ]),
      ),
    ).toEqual({
      TENDER_PRIMARY: 15,
      STRUCTURED_REQUIREMENT: 13,
      STRUCTURED_FIELD: 3,
      TENDER_METADATA: 1,
      SYSTEM_POLICY: 1,
    });
  });

  it.each(["documents", "eligibility", "risks"] as const)(
    "improves cited %s passage recall without broadening the source scope",
    (topic) => {
      const before = selectContext(topic, true);
      const after = selectContext(topic, false);
      expect(before.filter((chunk) => chunk.topic === topic)).toHaveLength(4);
      expect(after.filter((chunk) => chunk.topic === topic)).toHaveLength(8);
      expect(
        after.filter(
          (chunk) =>
            chunk.sourceClass === "TENDER_PRIMARY" && chunk.topic === topic,
        ),
      ).toHaveLength(5);
      expect(after.every((chunk) => chunk.hasValidCitation)).toBe(true);
      expect(new Set(after.map((chunk) => chunk.id)).size).toBe(8);
    },
  );

  it("retains metadata and cited fields for the successful summary category", () => {
    const after = selectContext("summary", false);
    expect(after.filter((chunk) => chunk.topic === "summary")).toHaveLength(4);
    expect(after.some((chunk) => chunk.id === "metadata")).toBe(true);
    expect(
      after.every((chunk) => chunks.some((source) => source.id === chunk.id)),
    ).toBe(true);
    expect(
      after
        .filter((chunk) => chunk.topic === "summary")
        .every((chunk) => chunk.hasValidCitation),
    ).toBe(true);
  });

  it("can select a query-specific cited exemption requirement", () => {
    const after = selectContext("exemptions", false);
    expect(
      after.some((chunk) => chunk.id === "requirement-eligibility-exemption"),
    ).toBe(true);
  });

  it("keeps unsupported topics unsupported despite filling eight slots", () => {
    const after = selectContext("unsupported", false);
    expect(after).toHaveLength(8);
    expect(after.map((chunk) => chunk.topic)).not.toContain("unsupported");
  });
});
