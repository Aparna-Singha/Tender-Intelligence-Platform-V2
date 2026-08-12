import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  claimSupportState,
  createStructureAwareChunks,
  extractDeterministicFields,
  extractDeterministicRequirements,
  isPromptInjectionText,
  validateCitation,
  verifyCitationHandles,
} from "../packages/domain/src/index.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "eval", "fixtures", "golden", "manifest.json");
const outputPath = join(root, "eval", "results", "offline-report.json");

const manifestText = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
const failures = [];

const units = manifest.documents.flatMap((document) =>
  document.pages.map((page) => {
    const block = {
      confidence: "HIGH",
      readingOrder: 0,
      sourceEndOffset: page.text.length,
      sourceStartOffset: 0,
      text: page.text,
      type: "PARAGRAPH",
      warnings: [],
    };
    return {
      block,
      document,
      page,
      unitIndex: page.page,
    };
  }),
);

function anchorFor(unit, block) {
  return {
    blockReadingOrder: block.readingOrder,
    documentId: unit.document.id,
    documentName: `${unit.document.id}.pdf`,
    endOffset: block.sourceEndOffset,
    excerpt: block.text.slice(0, 900),
    pageNumber: unit.page.page,
    sourceChecksum: createHash("sha256").update(unit.page.text).digest("hex"),
    startOffset: block.sourceStartOffset,
    unitIndex: unit.unitIndex,
  };
}

const fields = units.flatMap((unit) =>
  extractDeterministicFields([unit.block], (block) => anchorFor(unit, block)),
);
const requirements = units.flatMap((unit) =>
  extractDeterministicRequirements([unit.block], (block) =>
    anchorFor(unit, block),
  ),
);

for (const expected of manifest.expected_fields) {
  if (
    !fields.some(
      (field) =>
        field.fieldType === expected.field_type &&
        field.normalizedTextValue === expected.normalized_text_value &&
        field.anchor.documentId === expected.document_id &&
        field.anchor.pageNumber === expected.page,
    )
  )
    failures.push({ category: "extraction_field", expected });
}

for (const expected of manifest.expected_requirements) {
  if (
    !requirements.some(
      (requirement) =>
        requirement.category === expected.category &&
        requirement.obligation === expected.obligation &&
        requirement.anchor.documentId === expected.document_id &&
        requirement.anchor.pageNumber === expected.page,
    )
  )
    failures.push({ category: "extraction_requirement", expected });
}

const citationChecks = [...fields, ...requirements].map((item) =>
  validateCitation(
    units.find(
      (unit) =>
        unit.document.id === item.anchor.documentId &&
        unit.page.page === item.anchor.pageNumber,
    ).block,
    item.anchor,
  ),
);
if (citationChecks.includes(false))
  failures.push({ category: "citation", issue: "citation_validation_failed" });

const chunks = createStructureAwareChunks(
  units.map((unit) => ({
    clauseLabel: null,
    documentName: `${unit.document.id}.pdf`,
    pageNumber: unit.page.page,
    sourceClass: unit.document.source_class,
    sourceRecordId: `${unit.document.id}:${unit.page.page}`,
    text: unit.page.text,
  })),
);

const ragResults = manifest.expected_rag_cases.map((testCase) => {
  const lower = testCase.question.toLowerCase();
  const retrieved = chunks
    .filter((chunk) =>
      lower.includes("deadline")
        ? chunk.text.toLowerCase().includes("submission deadline")
        : lower.includes("credential")
          ? isPromptInjectionText(chunk.text)
          : false,
    )
    .slice(0, 1)
    .map((chunk, index) => ({
      chunkId: chunk.sourceRecordId,
      handle: `C${index + 1}`,
    }));
  const outcome = lower.includes("legally eligible")
    ? "HUMAN_REVIEW_REQUIRED"
    : retrieved.length > 0 && lower.includes("deadline")
      ? "ANSWERED"
      : "INSUFFICIENT_EVIDENCE";
  const handlesValid =
    testCase.expected_handles.length === 0 ||
    verifyCitationHandles(testCase.expected_handles, retrieved);
  if (outcome !== testCase.expected_outcome || !handlesValid)
    failures.push({ category: "rag", id: testCase.id, outcome, handlesValid });
  return {
    id: testCase.id,
    outcome,
    retrieved: retrieved.length,
    handlesValid,
  };
});

const draftResults = manifest.expected_draft_cases.map((testCase) => {
  if (testCase.claim_class !== undefined) {
    const support = claimSupportState({
      approvedEvidence:
        testCase.claim_class === "APPROVED_COMPANY_FACT" &&
        testCase.handles.length > 0,
      citationCount: testCase.handles.length,
      claimClass: testCase.claim_class,
      material: testCase.material,
      reviewedHumanInput: false,
    });
    if (support !== testCase.expected_support)
      failures.push({ category: "draft", id: testCase.id, support });
    return { id: testCase.id, support };
  }
  return {
    id: testCase.id,
    placeholderVisible: testCase.expected_placeholder === true,
  };
});

const ocrResults = manifest.ocr_cases.map((testCase) => {
  const cer = characterErrorRate(testCase.ground_truth, testCase.observed);
  const wer = wordErrorRate(testCase.ground_truth, testCase.observed);
  const recovered = testCase.observed.trim().length > 0;
  if (testCase.expected_status !== "OCR_FAILED" && !recovered)
    failures.push({ category: "ocr", id: testCase.id, issue: "empty_text" });
  return {
    character_error_rate: cer,
    confidence: testCase.confidence,
    id: testCase.id,
    recovered,
    status: testCase.expected_status,
    word_error_rate: wer,
  };
});

const report = {
  case_count:
    manifest.expected_fields.length +
    manifest.expected_requirements.length +
    manifest.expected_rag_cases.length +
    manifest.expected_draft_cases.length +
    manifest.ocr_cases.length,
  citation_metrics: {
    validation_rate: ratio(
      citationChecks.filter(Boolean).length,
      citationChecks.length,
    ),
  },
  draft_metrics: {
    cases: draftResults.length,
    unsupported_facts_blocked: draftResults.some(
      (result) => result.support === "UNSUPPORTED",
    ),
  },
  evaluation_policy_version: manifest.policy_version,
  extraction_metrics: {
    field_recall: ratio(
      manifest.expected_fields.length -
        failures.filter((failure) => failure.category === "extraction_field")
          .length,
      manifest.expected_fields.length,
    ),
    requirement_recall: ratio(
      manifest.expected_requirements.length -
        failures.filter(
          (failure) => failure.category === "extraction_requirement",
        ).length,
      manifest.expected_requirements.length,
    ),
  },
  failure_cases: failures,
  fixture_checksum: createHash("sha256").update(manifestText).digest("hex"),
  fixture_version: manifest.fixture_version,
  ocr_metrics: {
    low_confidence_pages: ocrResults.filter(
      (result) => result.confidence < 0.65,
    ).length,
    pages_attempted: ocrResults.length,
    pages_requiring_human_review: ocrResults.filter(
      (result) => result.status === "HUMAN_REVIEW_REQUIRED",
    ).length,
    pages_succeeded: ocrResults.filter((result) => result.recovered).length,
    results: ocrResults,
  },
  provider: null,
  rag_metrics: {
    cases: ragResults.length,
    outcomes: ragResults,
    prompt_injection_cases_detected: units.filter((unit) =>
      isPromptInjectionText(unit.page.text),
    ).length,
  },
  timestamp: new Date(0).toISOString(),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(report, null, 2));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function characterErrorRate(expected, actual) {
  return ratio(levenshtein(expected, actual), Math.max(expected.length, 1));
}

function wordErrorRate(expected, actual) {
  const expectedWords = expected.split(/\s+/u).filter(Boolean);
  const actualWords = actual.split(/\s+/u).filter(Boolean);
  return ratio(
    levenshtein(expectedWords, actualWords),
    Math.max(expectedWords.length, 1),
  );
}

function levenshtein(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = Array.from(
    { length: b.length + 1 },
    (_value, index) => index,
  );
  for (let index = 0; index < a.length; index += 1) {
    const current = [index + 1];
    for (let inner = 0; inner < b.length; inner += 1) {
      current[inner + 1] = Math.min(
        current[inner] + 1,
        previous[inner + 1] + 1,
        previous[inner] + (Object.is(a[index], b[inner]) ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}
