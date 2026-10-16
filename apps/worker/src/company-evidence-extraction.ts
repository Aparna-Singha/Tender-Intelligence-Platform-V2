import type { ParsedDocument } from "@tender/domain";

export interface ExtractedCompanyEvidenceFact {
  readonly boundedExcerpt: string;
  readonly confidence: number;
  readonly currency?: string;
  readonly dateValue?: Date;
  readonly factType: string;
  readonly locatorType:
    "AUTOMATED_DOCUMENT_EXTRACTION" | "AUTOMATED_OCR_EXTRACTION";
  readonly numberValue?: number;
  readonly pageNumber: number;
  readonly scope?: string;
  readonly textValue?: string;
  readonly validFrom?: Date;
  readonly validUntil?: Date;
  readonly valueType: "DATE" | "NUMBER" | "TEXT";
}

interface PageText {
  readonly confidence: number;
  readonly locatorType: ExtractedCompanyEvidenceFact["locatorType"];
  readonly pageNumber: number;
  readonly text: string;
}

export function extractCompanyEvidenceFacts(
  parsed: ParsedDocument,
): readonly ExtractedCompanyEvidenceFact[] {
  return pages(parsed).flatMap((page) => extractPage(page));
}

export function normalizeAddress(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bphase\s*[- ]?ii\b/gu, "phase 2")
    .replace(/\bphase\s*[- ]?i\b/gu, "phase 1")
    .replace(/\bbangalore\b/gu, "bengaluru")
    .replace(/\brd\b/gu, "road")
    .replace(/\bst\b/gu, "street")
    .replace(/\b(?:pvt|private)\.?\s+(?:ltd|limited)\.?\b/gu, "private limited")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function addressesMateriallyDiffer(
  left: string,
  right: string,
): boolean {
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  if (a === b) return false;
  const leftPostal = /\b\d{6}\b/u.exec(a)?.[0];
  const rightPostal = /\b\d{6}\b/u.exec(b)?.[0];
  if (leftPostal !== undefined && rightPostal !== undefined)
    return leftPostal !== rightPostal;
  const leftTokens = new Set(a.split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(b.split(" ").filter((token) => token.length > 1));
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  );
  const union = new Set([...leftTokens, ...rightTokens]);
  return union.size === 0 || intersection.length / union.size < 0.6;
}

export function scopeValue(scope: string | null, label: string): string | null {
  if (scope === null) return null;
  const pattern = new RegExp(
    `(?:^|;\\s*)${escapeRegExp(label)}:\\s*(.*?)(?=;\\s*[A-Z][^:;]{1,50}:|$)`,
    "iu",
  );
  return pattern.exec(scope)?.[1]?.trim() ?? null;
}

function pages(parsed: ParsedDocument): readonly PageText[] {
  return parsed.units.map((unit) => ({
    confidence: confidenceNumber(unit.confidence),
    locatorType: ["OCR_PERFORMED", "HUMAN_REVIEW_REQUIRED"].includes(
      unit.ocrStatus,
    )
      ? "AUTOMATED_OCR_EXTRACTION"
      : "AUTOMATED_DOCUMENT_EXTRACTION",
    pageNumber: unit.unitIndex,
    text: unit.blocks
      .map((block) => block.text)
      .join("\n")
      .replace(/[\t ]+/gu, " ")
      .trim(),
  }));
}

function extractPage(page: PageText): readonly ExtractedCompanyEvidenceFact[] {
  const text = page.text;
  if (/\bGST (?:Registration Certificate|Certificate)\b/iu.test(text)) {
    const gstin = field(text, "GSTIN");
    const legalName = field(text, "Legal name");
    const address = field(text, "Principal place of business");
    const status = field(text, "Status");
    if (gstin !== null && legalName !== null && address !== null)
      return [
        {
          ...textFact(page, "GST_REGISTRATION", gstin, "GSTIN", {
            scope: joinedScope([
              ["Legal name", legalName],
              ["Principal address", address],
              ["Status", status],
              ["PAN", field(text, "PAN")],
            ]),
          }),
          boundedExcerpt:
            `GSTIN: ${gstin}; Legal name: ${legalName}; Principal address: ${address}`.slice(
              0,
              1_000,
            ),
        },
      ];
  }
  if (/\bUdyam Registration Certificate\b/iu.test(text)) {
    const number = field(text, "Udyam number");
    if (number !== null)
      return [
        textFact(page, "UDYAM_REGISTRATION", number, "Udyam number", {
          scope: joinedScope([
            ["Enterprise name", field(text, "Enterprise name")],
            ["Enterprise type", field(text, "Enterprise type")],
            ["Major activity", field(text, "Major activity")],
            ["Activity", field(text, "Activity")],
            ["Registered address", field(text, "Registered address")],
          ]),
        }),
      ];
  }
  if (/\bCertificate of Incorporation\b/iu.test(text)) {
    const cin = field(text, "CIN");
    if (cin !== null)
      return [
        textFact(page, "INCORPORATION", cin, "CIN", {
          scope: joinedScope([
            ["Company name", field(text, "Company name")],
            ["Incorporation date", field(text, "Incorporation date")],
            ["Registered office", field(text, "Registered office")],
            ["Status", field(text, "Status")],
          ]),
        }),
      ];
  }
  if (/\bPast Purchase Order\b/iu.test(text)) {
    const value = money(field(text, "Order value"));
    if (value !== null)
      return [
        numberFact(page, "PURCHASE_ORDER_VALUE", value, "Order value", {
          currency: "INR",
          scope: joinedScope([
            ["PO number", field(text, "PO")],
            ["Customer", field(text, "Customer")],
            ["Supplier", field(text, "Supplier")],
            ["PO date", field(text, "PO date")],
            ["Supply description", field(text, "Scope")],
          ]),
        }),
      ];
  }
  if (/\bTax Invoice\b|\bInvoice — Irrelevant Experience\b/iu.test(text)) {
    const invoice = field(text, "Invoice");
    if (invoice !== null)
      return [
        textFact(page, "INVOICE_REFERENCE", invoice, "Invoice", {
          scope: joinedScope([
            ["Related PO", field(text, "Related PO")],
            ["Customer", field(text, "Customer")],
            ["Supplier", field(text, "Supplier")],
            ["Invoice date", field(text, "Invoice date")],
            ["Taxable value", field(text, "Taxable value")],
            ["Supply description", field(text, "Description")],
          ]),
        }),
      ];
  }
  if (/\bCompletion \/ Performance Certificate\b/iu.test(text)) {
    const reference = field(text, "Reference PO");
    if (reference !== null)
      return [
        textFact(page, "COMPLETION_REFERENCE", reference, "Reference PO", {
          scope: joinedScope([
            ["Customer", field(text, "Customer")],
            ["Supplier", field(text, "Supplier")],
            ["Completion date", field(text, "Completion date")],
            ["Performance", field(text, "Performance")],
          ]),
        }),
      ];
  }
  if (/\bCA-Certified Turnover Statement\b/iu.test(text)) {
    const average = money(field(text, "3-year average"));
    if (average !== null)
      return [
        numberFact(page, "TURNOVER_3_YEAR_AVERAGE", average, "3-year average", {
          currency: "INR",
          scope: joinedScope([
            ["Company", field(text, "Company")],
            ["FY 2023-24", field(text, "2023-24")],
            ["FY 2024-25", field(text, "2024-25")],
            ["FY 2025-26", field(text, "2025-26")],
            ["Purpose", field(text, "Purpose")],
          ]),
        }),
      ];
  }
  if (/\bISO 9001(?::2015)? Certificate\b/iu.test(text)) {
    const standard = field(text, "Standard");
    const validFrom = parseDate(field(text, "Issue date"));
    const validUntil = parseDate(field(text, "Valid until"));
    if (standard !== null)
      return [
        textFact(page, "ISO_9001_CERTIFICATION", standard, "Standard", {
          scope: joinedScope([
            ["Certificate holder", field(text, "Certificate holder")],
            ["Certificate number", field(text, "Certificate no.")],
            ["Certification scope", field(text, "Scope")],
          ]),
          ...(validFrom === null ? {} : { validFrom }),
          ...(validUntil === null ? {} : { validUntil }),
        }),
      ];
  }
  if (/\bOEM Authorisation Letter\b/iu.test(text)) {
    const oem = field(text, "OEM");
    const validFrom = parseDate(field(text, "Authorisation date"));
    const validUntil = parseDate(field(text, "Valid through"));
    if (oem !== null)
      return [
        textFact(page, "OEM_AUTHORISATION", oem, "OEM", {
          scope: joinedScope([
            ["Authorised bidder", field(text, "Authorised bidder")],
            ["Tender reference", field(text, "Tender")],
            ["Product family", field(text, "Product family")],
          ]),
          ...(validFrom === null ? {} : { validFrom }),
          ...(validUntil === null ? {} : { validUntil }),
        }),
      ];
  }
  if (/\bExperience Confirmation Letter\b/iu.test(text)) {
    const value = money(field(text, "Approximate supply value"));
    if (value !== null)
      return [
        numberFact(
          page,
          "EXPERIENCE_CERTIFICATE_VALUE",
          value,
          "Approximate supply value",
          {
            currency: "INR",
            scope: joinedScope([
              ["Customer", field(text, "Customer")],
              ["Supplier", field(text, "Supplier")],
              ["Reference", field(text, "Reference")],
              ["Date", field(text, "Date")],
              [
                "Supply description",
                sentenceAfter(text, "This is to confirm supply of"),
              ],
            ]),
          },
        ),
      ];
  }
  return [];
}

function field(text: string, label: string): string | null {
  const lines = text
    .split(/\n+/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0);
  const exactPattern = new RegExp(`^${escapeRegExp(label)}$`, "iu");
  const separator = /^\d/u.test(label)
    ? "(?:\\s*[:—-]\\s*|\\s+)"
    : "\\s*[:—-]\\s*";
  const inlinePattern = new RegExp(
    `^${escapeRegExp(label)}${separator}(.+)$`,
    "iu",
  );
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    const inline = inlinePattern.exec(line)?.[1]?.trim();
    if (inline !== undefined && inline !== "") return inline;
    if (exactPattern.test(line)) return lines[index + 1] ?? null;
  }
  return null;
}

function sentenceAfter(text: string, prefix: string): string | null {
  const match = new RegExp(`${escapeRegExp(prefix)}\\s+([^.]*)`, "iu").exec(
    text,
  );
  return match?.[1]?.trim() ?? null;
}

function textFact(
  page: PageText,
  factType: string,
  value: string,
  label: string,
  extra: Partial<ExtractedCompanyEvidenceFact> = {},
): ExtractedCompanyEvidenceFact {
  return {
    boundedExcerpt: `${label}: ${value}`.slice(0, 1_000),
    confidence: page.confidence,
    factType,
    locatorType: page.locatorType,
    pageNumber: page.pageNumber,
    textValue: value.slice(0, 1_000),
    valueType: "TEXT",
    ...extra,
  };
}

function numberFact(
  page: PageText,
  factType: string,
  value: number,
  label: string,
  extra: Partial<ExtractedCompanyEvidenceFact> = {},
): ExtractedCompanyEvidenceFact {
  return {
    boundedExcerpt: `${label}: INR ${value.toLocaleString("en-IN")}`,
    confidence: page.confidence,
    factType,
    locatorType: page.locatorType,
    numberValue: value,
    pageNumber: page.pageNumber,
    valueType: "NUMBER",
    ...extra,
  };
}

function joinedScope(
  entries: readonly (readonly [string, string | null])[],
): string {
  return entries
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .map(([label, value]) => `${label}: ${value}`)
    .join("; ")
    .slice(0, 1_000);
}

function money(value: string | null): number | null {
  if (value === null) return null;
  const match = /(?:INR|₹)\s*([\d,]+(?:\.\d+)?)/iu.exec(value);
  if (match?.[1] === undefined) return null;
  const number = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const match =
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/iu.exec(
      value,
    );
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  )
    return null;
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const month = months.indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
}

function confidenceNumber(value: string): number {
  if (value === "HIGH") return 0.95;
  if (value === "MEDIUM") return 0.8;
  if (value === "LOW") return 0.6;
  return 0.45;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
