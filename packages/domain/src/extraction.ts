export const PARSER_POLICY_VERSION = "deterministic-v1";
export const STRUCTURING_POLICY_VERSION = "rules-v1";

export type SourceFormat = "CSV" | "DOCX" | "PDF" | "XLSX" | "ZIP_MEMBER";
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "HUMAN_REVIEW_REQUIRED";
export type NormalizedBlockType =
  | "HEADING"
  | "PARAGRAPH"
  | "LIST_ITEM"
  | "TABLE"
  | "TABLE_CELL"
  | "UNCLASSIFIED";

export interface ParsedTableCell {
  readonly cellReference?: string;
  readonly columnIndex: number;
  readonly columnSpan?: number;
  readonly displayedValue: string;
  readonly formulaText?: string;
  readonly rowIndex: number;
  readonly rowSpan?: number;
}

export interface ParsedTable {
  readonly cells: readonly ParsedTableCell[];
  readonly columnCount: number;
  readonly rowCount: number;
}

export interface ParsedBlock {
  readonly confidence: Confidence;
  readonly coordinates?: Readonly<Record<string, number>>;
  readonly headingLevel?: number;
  readonly readingOrder: number;
  readonly sourceEndOffset: number;
  readonly sourceStartOffset: number;
  readonly table?: ParsedTable;
  readonly text: string;
  readonly type: NormalizedBlockType;
  readonly warnings: readonly string[];
}

export interface ParsedUnit {
  readonly archiveMemberPath?: string;
  readonly blocks: readonly ParsedBlock[];
  readonly characterCount: number;
  readonly confidence: Confidence;
  readonly label?: string;
  readonly language?: string;
  readonly ocrStatus:
    "NOT_REQUIRED" | "OCR_UNAVAILABLE" | "HUMAN_REVIEW_REQUIRED";
  readonly unitIndex: number;
  readonly unitType: "ARCHIVE_MEMBER" | "PAGE" | "SHEET";
}

export interface ParsedDocument {
  readonly format: SourceFormat;
  readonly issues: readonly ExtractionIssueCandidate[];
  readonly parserName: string;
  readonly parserVersion: string;
  readonly units: readonly ParsedUnit[];
}

export interface TenderDocumentParser {
  readonly supportedExtensions: readonly string[];
  parse(content: Uint8Array, signal?: AbortSignal): Promise<ParsedDocument>;
}

export interface OcrPageInput {
  readonly image: Uint8Array;
  readonly languageHints: readonly string[];
  readonly pageNumber: number;
}

export interface OcrPageOutput {
  readonly confidence: number;
  readonly engineName: string;
  readonly engineVersion: string;
  readonly language: string;
  readonly text: string;
}

export interface OcrEngine {
  readonly available: boolean;
  recognize(input: OcrPageInput, signal?: AbortSignal): Promise<OcrPageOutput>;
}

export interface ExtractionIssueCandidate {
  readonly issueType:
    | "LOW_TEXT_COVERAGE"
    | "LOW_CONFIDENCE"
    | "MALFORMED_DOCUMENT"
    | "MANUAL_REVIEW_REQUIRED"
    | "OCR_UNAVAILABLE"
    | "PASSWORD_PROTECTED"
    | "PARTIAL_EXTRACTION"
    | "TABLE_EXTRACTION_UNCERTAIN"
    | "UNSUPPORTED_FORMAT";
  readonly requiresHumanReview: boolean;
  readonly safeMessage: string;
  readonly severity: "INFO" | "WARNING" | "ERROR";
  readonly unitIndex?: number;
}

export interface SourceAnchor {
  readonly archiveMemberPath?: string;
  readonly blockReadingOrder: number;
  readonly documentId: string;
  readonly documentName: string;
  readonly excerpt: string;
  readonly pageNumber?: number;
  readonly sheetName?: string;
  readonly sourceChecksum: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly unitIndex: number;
}

export interface ClassifiedSectionCandidate {
  readonly category: string;
  readonly confidence: Confidence;
  readonly endReadingOrder: number;
  readonly startReadingOrder: number;
  readonly state:
    "CLASSIFIED" | "LOW_CONFIDENCE" | "UNCLASSIFIED" | "HUMAN_REVIEW_REQUIRED";
  readonly title: string;
}

export interface ExtractedFieldCandidate {
  readonly anchor: SourceAnchor;
  readonly confidence: Confidence;
  readonly fieldType: string;
  readonly findingState:
    "FOUND" | "AMBIGUOUS" | "CONFLICTING" | "HUMAN_REVIEW_REQUIRED";
  readonly normalizedDateValue?: Date;
  readonly normalizedTextValue: string;
  readonly sourceWording: string;
}

export interface RequirementCandidate {
  readonly anchor: SourceAnchor;
  readonly category: string;
  readonly confidence: Confidence;
  readonly findingState: "FOUND" | "AMBIGUOUS" | "HUMAN_REVIEW_REQUIRED";
  readonly normalizedStatement: string;
  readonly obligation: "MANDATORY" | "OPTIONAL" | "CONDITIONAL" | "UNSPECIFIED";
  readonly sourceWording: string;
  readonly title: string;
}

const sectionRules: readonly [RegExp, string][] = [
  [
    /\b(eligibility|qualification|turnover|experience)\b/iu,
    "ELIGIBILITY_CRITERIA",
  ],
  [/\b(scope of work|scope)\b/iu, "SCOPE_OF_WORK"],
  [
    /\b(technical specification|specifications?)\b/iu,
    "TECHNICAL_SPECIFICATIONS",
  ],
  [/\b(emd|bid security)\b/iu, "BID_SECURITY_EMD"],
  [
    /\b(performance security|performance bank guarantee|pbg)\b/iu,
    "PERFORMANCE_SECURITY",
  ],
  [
    /\b(important dates?|submission deadline|bid opening)\b/iu,
    "IMPORTANT_DATES",
  ],
  [/\b(boq|bill of quantities)\b/iu, "BOQ"],
  [/\b(payment terms?)\b/iu, "PAYMENT_TERMS"],
  [/\b(delivery|implementation schedule)\b/iu, "DELIVERY_TERMS"],
];

const requirementRules: readonly [RegExp, string][] = [
  [/\b(turnover)\b/iu, "ANNUAL_TURNOVER"],
  [/\b(experience|similar work|past performance)\b/iu, "EXPERIENCE"],
  [/\b(certification|iso certificate)\b/iu, "CERTIFICATION"],
  [/\b(licen[cs]e)\b/iu, "LICENCE"],
  [/\b(oem|manufacturer authori[sz]ation)\b/iu, "OEM_AUTHORISATION"],
  [/\b(emd|bid security)\b/iu, "EMD"],
  [
    /\b(performance guarantee|performance security|pbg)\b/iu,
    "PERFORMANCE_GUARANTEE",
  ],
  [/\b(deliver|delivery)\b/iu, "DELIVERY"],
  [
    /\b(document|certificate|declaration).*(submit|required)/iu,
    "DOCUMENT_SUBMISSION",
  ],
  [
    /\b(technical specification|shall comply|must comply)\b/iu,
    "TECHNICAL_SPECIFICATION",
  ],
];

export function classifySections(
  blocks: readonly ParsedBlock[],
): readonly ClassifiedSectionCandidate[] {
  return blocks
    .filter((block) => block.type === "HEADING")
    .map((block, index, headings) => {
      const match = sectionRules.find(([pattern]) => pattern.test(block.text));
      return {
        category: match?.[1] ?? "OTHER",
        confidence: match === undefined ? "LOW" : "HIGH",
        endReadingOrder:
          (headings[index + 1]?.readingOrder ?? block.readingOrder + 1) - 1,
        startReadingOrder: block.readingOrder,
        state: match === undefined ? "LOW_CONFIDENCE" : "CLASSIFIED",
        title: block.text.slice(0, 300),
      };
    });
}

export function extractDeterministicRequirements(
  blocks: readonly ParsedBlock[],
  anchorFor: (block: ParsedBlock) => SourceAnchor,
): readonly RequirementCandidate[] {
  return blocks.flatMap((block) => {
    if (
      !/\b(must|shall|required|should|may need to|is to be)\b/iu.test(
        block.text,
      )
    )
      return [];
    const category =
      requirementRules.find(([pattern]) => pattern.test(block.text))?.[1] ??
      "OTHER";
    const obligation = /\b(must|shall|required)\b/iu.test(block.text)
      ? "MANDATORY"
      : /\b(if|where applicable|subject to|unless)\b/iu.test(block.text)
        ? "CONDITIONAL"
        : "OPTIONAL";
    const ambiguous = /\b(may|normally|generally|as applicable)\b/iu.test(
      block.text,
    );
    return [
      {
        anchor: anchorFor(block),
        category,
        confidence: ambiguous ? "LOW" : block.confidence,
        findingState: ambiguous ? "AMBIGUOUS" : "FOUND",
        normalizedStatement: block.text.trim().slice(0, 4000),
        obligation,
        sourceWording: block.text.slice(0, 8000),
        title: `${category.replaceAll("_", " ")} requirement`.slice(0, 300),
      },
    ];
  });
}

export function extractDeterministicFields(
  blocks: readonly ParsedBlock[],
  anchorFor: (block: ParsedBlock) => SourceAnchor,
): readonly ExtractedFieldCandidate[] {
  const patterns: readonly [string, RegExp][] = [
    [
      "SUBMISSION_DEADLINE",
      /\b(?:submission|bid)\s+(?:deadline|end\s+date(?:\/time)?)\s*[:-]?\s*([^\n.;]{4,100})/iu,
    ],
    ["EMD_WORDING", /\b(?:emd|bid security)\s*[:-]\s*([^\n.;]{2,200})/iu],
    [
      "MINIMUM_TURNOVER",
      /\b(?:minimum\s+)?turnover\s*[:-]\s*([^\n.;]{2,200})/iu,
    ],
    [
      "EXPERIENCE_REQUIREMENT",
      /\b(?:minimum\s+)?experience\s*[:-]\s*([^\n.;]{2,200})/iu,
    ],
  ];
  return blocks.flatMap((block) =>
    patterns.flatMap(([fieldType, pattern]) => {
      const match = pattern.exec(block.text);
      if (match?.[1] === undefined) return [];
      const normalizedTextValue = match[1].trim();
      const normalizedDateValue =
        fieldType === "SUBMISSION_DEADLINE"
          ? normalizeTenderCalendarDate(normalizedTextValue)
          : null;
      return [
        {
          anchor: anchorFor(block),
          confidence: block.confidence,
          fieldType,
          findingState: "FOUND",
          ...(normalizedDateValue === null ? {} : { normalizedDateValue }),
          normalizedTextValue,
          sourceWording: block.text,
        },
      ];
    }),
  );
}

const INDIA_TIMEZONE_OFFSET_MINUTES = 330;
const TENDER_DATE_TIME_PATTERN =
  /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))(?::(\d{2}))?\s*(AM|PM)?)?$/iu;

interface ParsedTenderDateTimeParts {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
  readonly second: number;
  readonly year: number;
}

export function parseTenderDateTime(value: string): Date | null {
  const parsedParts = parseTenderDateTimeParts(value);
  if (parsedParts === null) return null;
  const utcMilliseconds =
    Date.UTC(
      parsedParts.year,
      parsedParts.month - 1,
      parsedParts.day,
      parsedParts.hour,
      parsedParts.minute,
      parsedParts.second,
    ) -
    INDIA_TIMEZONE_OFFSET_MINUTES * 60_000;
  const parsed = new Date(utcMilliseconds);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function normalizeTenderCalendarDate(value: string): Date | null {
  const parsedParts = parseTenderDateTimeParts(value);
  if (parsedParts === null) return null;
  return new Date(
    Date.UTC(
      parsedParts.year,
      parsedParts.month - 1,
      parsedParts.day,
    ),
  );
}

function parseTenderDateTimeParts(
  value: string,
): ParsedTenderDateTimeParts | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  const match = TENDER_DATE_TIME_PATTERN.exec(normalized);
  if (match === null) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = match[3]?.length === 2 ? 2000 + rawYear : rawYear;
  let hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  const meridiem = match[7]?.toUpperCase() ?? null;
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    day < 1 ||
    month < 1 ||
    month > 12 ||
    !isValidCalendarDate(year, month, day) ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  if (meridiem !== null) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return { day, hour, minute, month, second, year };
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1]!;
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

export function validateCitation(
  block: ParsedBlock,
  anchor: SourceAnchor,
): boolean {
  return (
    anchor.startOffset === block.sourceStartOffset &&
    anchor.endOffset === block.sourceEndOffset &&
    anchor.endOffset > anchor.startOffset &&
    block.text.includes(anchor.excerpt)
  );
}
