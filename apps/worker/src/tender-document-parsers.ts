import {
  getDocument,
  version as pdfJsVersion,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { unzipSync } from "fflate";
import type {
  ExtractionIssueCandidate,
  ParsedBlock,
  ParsedDocument,
  ParsedTableCell,
  ParsedUnit,
  TenderDocumentParser,
} from "@tender/domain";
import { validateZipEntries } from "@tender/domain";
import { createHash } from "node:crypto";
import { readZipDirectory } from "./tender-processor.js";

const MAX_PDF_PAGES = 500;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_SHEETS = 50;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;
const MAX_CELLS = 200_000;
const MAX_FIELD_CHARS = 32_000;

export class PdfParser implements TenderDocumentParser {
  public readonly supportedExtensions = [".pdf"] as const;

  public async parse(
    content: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ParsedDocument> {
    const issues: ExtractionIssueCandidate[] = [];
    let document;
    let loadingTask;
    try {
      loadingTask = getDocument({
        data: content.slice(),
        disableAutoFetch: true,
        disableFontFace: true,
        disableRange: true,
        useWorkerFetch: false,
      });
      document = await loadingTask.promise;
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : "UnknownError";
      if (/password/iu.test(name))
        throw new ParserFailure("PASSWORD_PROTECTED");
      throw new ParserFailure("MALFORMED_DOCUMENT");
    }
    if (document.numPages > MAX_PDF_PAGES)
      throw new ParserFailure("PAGE_LIMIT_EXCEEDED");
    const units: ParsedUnit[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const textItems = textContent.items
        .filter((item) => "str" in item)
        .map((item) => ({
          height: item.height,
          str: item.str,
          transform: item.transform,
          width: item.width,
        }));
      const blocks = buildPdfBlocks(textItems);
      const characterCount = blocks.reduce(
        (total, block) => total + block.text.length,
        0,
      );
      const needsOcr = characterCount < 20;
      if (needsOcr)
        issues.push({
          issueType: "OCR_UNAVAILABLE",
          requiresHumanReview: true,
          safeMessage:
            "This page has insufficient embedded text and no OCR engine is configured.",
          severity: "WARNING",
          unitIndex: pageNumber,
        });
      units.push({
        blocks,
        characterCount,
        confidence: needsOcr ? "HUMAN_REVIEW_REQUIRED" : "HIGH",
        label: `Page ${pageNumber}`,
        ocrStatus: needsOcr ? "OCR_UNAVAILABLE" : "NOT_REQUIRED",
        unitIndex: pageNumber,
        unitType: "PAGE",
      });
      page.cleanup();
    }
    await loadingTask.destroy();
    return {
      format: "PDF",
      issues,
      parserName: "pdfjs-dist",
      parserVersion: pdfJsVersion,
      units,
    };
  }
}

export class DocxParser implements TenderDocumentParser {
  public readonly supportedExtensions = [".docx"] as const;

  public async parse(
    content: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ParsedDocument> {
    await Promise.resolve();
    signal?.throwIfAborted();
    const files = readOoxml(content);
    const documentXml = textFile(files, "word/document.xml");
    const paragraphs = Array.from(
      documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gu),
    );
    const blocks: ParsedBlock[] = [];
    let offset = 0;
    for (const paragraph of paragraphs) {
      signal?.throwIfAborted();
      const xml = paragraph[1] ?? "";
      const text = xmlText(xml);
      if (text.length === 0) continue;
      const headingMatch = /<w:pStyle[^>]*w:val="Heading([1-9])"/u.exec(xml);
      blocks.push({
        confidence: "HIGH",
        ...(headingMatch?.[1] === undefined
          ? {}
          : { headingLevel: Number(headingMatch[1]) }),
        readingOrder: blocks.length,
        sourceEndOffset: offset + text.length,
        sourceStartOffset: offset,
        text,
        type:
          headingMatch === null
            ? /<w:numPr[ >]/u.test(xml)
              ? "LIST_ITEM"
              : "PARAGRAPH"
            : "HEADING",
        warnings: [],
      });
      offset += text.length + 1;
    }
    const tableBlocks = parseWordTables(documentXml, blocks.length, offset);
    blocks.push(...tableBlocks);
    return {
      format: "DOCX",
      issues: [],
      parserName: "ooxml-deterministic",
      parserVersion: "1",
      units: [
        {
          blocks,
          characterCount: blocks.reduce(
            (total, block) => total + block.text.length,
            0,
          ),
          confidence: "HIGH",
          label: "Document",
          ocrStatus: "NOT_REQUIRED",
          unitIndex: 1,
          unitType: "PAGE",
        },
      ],
    };
  }
}

export class SpreadsheetParser implements TenderDocumentParser {
  public readonly supportedExtensions = [".xlsx"] as const;

  public async parse(
    content: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ParsedDocument> {
    await Promise.resolve();
    const files = readOoxml(content);
    const sharedStrings = parseSharedStrings(files);
    const sheets = parseSheetNames(files);
    if (sheets.length > MAX_SHEETS)
      throw new ParserFailure("SHEET_LIMIT_EXCEEDED");
    let totalCells = 0;
    const units: ParsedUnit[] = [];
    for (const [index, sheet] of sheets.entries()) {
      signal?.throwIfAborted();
      const xml = textFile(files, sheet.path);
      const cells: ParsedTableCell[] = [];
      let maxRow = 0;
      let maxColumn = 0;
      for (const match of xml.matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/gu)) {
        const attributes = match[1] ?? "";
        const body = match[2] ?? "";
        const reference = attribute(attributes, "r");
        if (reference === null) continue;
        const coordinates = cellCoordinates(reference);
        maxRow = Math.max(maxRow, coordinates.row);
        maxColumn = Math.max(maxColumn, coordinates.column);
        if (maxRow > MAX_ROWS || maxColumn > MAX_COLUMNS)
          throw new ParserFailure("SPREADSHEET_DIMENSION_LIMIT");
        totalCells += 1;
        if (totalCells > MAX_CELLS)
          throw new ParserFailure("CELL_LIMIT_EXCEEDED");
        const type = attribute(attributes, "t");
        const rawValue = elementText(body, "v") ?? elementText(body, "t") ?? "";
        const value =
          type === "s"
            ? (sharedStrings[Number(rawValue)] ?? "")
            : decodeXml(rawValue);
        const formula = elementText(body, "f");
        cells.push({
          cellReference: reference,
          columnIndex: coordinates.column,
          displayedValue: safeSpreadsheetDisplay(value),
          ...(formula === null ? {} : { formulaText: decodeXml(formula) }),
          rowIndex: coordinates.row,
        });
      }
      const tableText = cells
        .map((cell) => `${cell.cellReference ?? ""}: ${cell.displayedValue}`)
        .join("\n");
      const block: ParsedBlock = {
        confidence: "MEDIUM",
        readingOrder: 0,
        sourceEndOffset: tableText.length,
        sourceStartOffset: 0,
        table: {
          cells,
          columnCount: maxColumn,
          rowCount: maxRow,
        },
        text: tableText,
        type: "TABLE",
        warnings: ["TABLE_SEMANTICS_NOT_INFERRED"],
      };
      units.push({
        blocks: [block],
        characterCount: tableText.length,
        confidence: "MEDIUM",
        label: sheet.name,
        ocrStatus: "NOT_REQUIRED",
        unitIndex: index + 1,
        unitType: "SHEET",
      });
    }
    return {
      format: "XLSX",
      issues: [],
      parserName: "ooxml-deterministic",
      parserVersion: "1",
      units,
    };
  }
}

export class CsvParser implements TenderDocumentParser {
  public readonly supportedExtensions = [".csv"] as const;

  public async parse(
    content: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ParsedDocument> {
    await Promise.resolve();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new ParserFailure("UNSUPPORTED_ENCODING");
    }
    const delimiter = detectDelimiter(text);
    const rows = parseCsv(text, delimiter, signal);
    const cells: ParsedTableCell[] = [];
    let columnCount = 0;
    for (const [rowIndex, row] of rows.entries()) {
      columnCount = Math.max(columnCount, row.length);
      if (columnCount > MAX_COLUMNS)
        throw new ParserFailure("CSV_COLUMN_LIMIT_EXCEEDED");
      for (const [columnIndex, value] of row.entries()) {
        if (value.length > MAX_FIELD_CHARS)
          throw new ParserFailure("CSV_FIELD_LIMIT_EXCEEDED");
        cells.push({
          cellReference: `${columnName(columnIndex + 1)}${rowIndex + 1}`,
          columnIndex: columnIndex + 1,
          displayedValue: safeSpreadsheetDisplay(value),
          rowIndex: rowIndex + 1,
        });
      }
    }
    const blockText = rows.map((row) => row.join(" | ")).join("\n");
    return {
      format: "CSV",
      issues: [],
      parserName: "rfc4180-bounded",
      parserVersion: "1",
      units: [
        {
          blocks: [
            {
              confidence: "HIGH",
              readingOrder: 0,
              sourceEndOffset: blockText.length,
              sourceStartOffset: 0,
              table: {
                cells,
                columnCount,
                rowCount: rows.length,
              },
              text: blockText,
              type: "TABLE",
              warnings: [],
            },
          ],
          characterCount: blockText.length,
          confidence: "HIGH",
          label: "CSV",
          ocrStatus: "NOT_REQUIRED",
          unitIndex: 1,
          unitType: "SHEET",
        },
      ],
    };
  }
}

export class ParserRegistry {
  private readonly parsers = [
    new PdfParser(),
    new DocxParser(),
    new SpreadsheetParser(),
    new CsvParser(),
  ] as const;

  public async parse(
    extension: string,
    content: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ParsedDocument> {
    if (extension === ".zip") return this.parseArchive(content, signal);
    const parser = this.parsers.find((candidate) =>
      candidate.supportedExtensions.some(
        (supported) => supported === extension,
      ),
    );
    if (parser === undefined) throw new ParserFailure("UNSUPPORTED_FORMAT");
    return parser.parse(content, signal);
  }

  private async parseArchive(
    content: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ParsedDocument> {
    validateZipEntries(readZipDirectory(content));
    const files = unzipSync(content, {
      filter: (file) => file.originalSize <= MAX_ARCHIVE_BYTES,
    });
    const units: ParsedUnit[] = [];
    const issues: ExtractionIssueCandidate[] = [];
    for (const [path, member] of Object.entries(files)) {
      signal?.throwIfAborted();
      const extension = extensionFor(path);
      const parser = this.parsers.find((candidate) =>
        candidate.supportedExtensions.some(
          (supported) => supported === extension,
        ),
      );
      if (parser === undefined) {
        issues.push({
          issueType: "UNSUPPORTED_FORMAT",
          requiresHumanReview: false,
          safeMessage: `Archive member is visible but not processed: ${path.slice(0, 200)}`,
          severity: "INFO",
        });
        continue;
      }
      const parsed = await parser.parse(member, signal);
      const memberChecksum = createHash("sha256").update(member).digest("hex");
      units.push(
        ...parsed.units.map((unit, index) => ({
          ...unit,
          archiveMemberPath: path,
          label: `${path} — ${unit.label ?? `unit ${index + 1}`}`,
          unitIndex: units.length + index + 1,
          unitType: "ARCHIVE_MEMBER" as const,
        })),
      );
      issues.push(...parsed.issues);
      if (memberChecksum.length !== 64)
        throw new ParserFailure("MEMBER_CHECKSUM_FAILED");
    }
    return {
      format: "ZIP_MEMBER",
      issues,
      parserName: "fflate-bounded-registry",
      parserVersion: "1",
      units,
    };
  }
}

export class ParserFailure extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "ParserFailure";
  }
}

interface PdfTextItem {
  readonly height: number;
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
}

function buildPdfBlocks(items: readonly PdfTextItem[]): readonly ParsedBlock[] {
  const lines = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const y = Math.round(item.transform[5] ?? 0);
    const line = lines.get(y) ?? [];
    line.push(item);
    lines.set(y, line);
  }
  let offset = 0;
  return [...lines.entries()]
    .sort(([left], [right]) => right - left)
    .map(([y, line], readingOrder) => {
      const sorted = line.toSorted(
        (left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0),
      );
      const text = sorted
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      const start = offset;
      offset += text.length + 1;
      const averageHeight =
        sorted.reduce((total, item) => total + item.height, 0) /
        Math.max(sorted.length, 1);
      return {
        confidence: text.length < 3 ? "LOW" : "HIGH",
        coordinates: {
          height: averageHeight,
          width: sorted.reduce((total, item) => total + item.width, 0),
          x: sorted[0]?.transform[4] ?? 0,
          y,
        },
        readingOrder,
        sourceEndOffset: start + text.length,
        sourceStartOffset: start,
        text,
        type:
          averageHeight >= 14 && text.length <= 200 ? "HEADING" : "PARAGRAPH",
        warnings: text.length < 3 ? ["LOW_TEXT_CONTENT"] : [],
      } satisfies ParsedBlock;
    })
    .filter((block) => block.text.length > 0);
}

function readOoxml(content: Uint8Array): Record<string, Uint8Array> {
  validateZipEntries(readZipDirectory(content));
  return unzipSync(content, {
    filter: (file) => file.originalSize <= MAX_ARCHIVE_BYTES,
  });
}

function textFile(
  files: Readonly<Record<string, Uint8Array>>,
  path: string,
): string {
  const value = files[path];
  if (value === undefined) throw new ParserFailure("MALFORMED_DOCUMENT");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  if (/<!DOCTYPE/iu.test(text)) throw new ParserFailure("UNSAFE_XML_DOCTYPE");
  return text;
}

function xmlText(xml: string): string {
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu))
    .map((match) => decodeXml(match[1] ?? ""))
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseWordTables(
  xml: string,
  readingOrderStart: number,
  offsetStart: number,
): readonly ParsedBlock[] {
  return Array.from(
    xml.matchAll(/<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>/gu),
  ).map((tableMatch, tableIndex) => {
    const rows = Array.from(
      (tableMatch[1] ?? "").matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/gu),
    );
    const cells: ParsedTableCell[] = [];
    let columns = 0;
    for (const [rowIndex, row] of rows.entries()) {
      const rowCells = Array.from(
        (row[1] ?? "").matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/gu),
      );
      columns = Math.max(columns, rowCells.length);
      for (const [columnIndex, cell] of rowCells.entries())
        cells.push({
          columnIndex: columnIndex + 1,
          displayedValue: xmlText(cell[1] ?? ""),
          rowIndex: rowIndex + 1,
        });
    }
    const text = rows
      .map((row) =>
        Array.from(
          (row[1] ?? "").matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/gu),
        )
          .map((cell) => xmlText(cell[1] ?? ""))
          .join(" | "),
      )
      .join("\n");
    return {
      confidence: "MEDIUM",
      readingOrder: readingOrderStart + tableIndex,
      sourceEndOffset: offsetStart + text.length,
      sourceStartOffset: offsetStart,
      table: { cells, columnCount: columns, rowCount: rows.length },
      text,
      type: "TABLE",
      warnings: ["TABLE_ORDER_APPROXIMATED"],
    };
  });
}

function parseSharedStrings(
  files: Readonly<Record<string, Uint8Array>>,
): readonly string[] {
  if (files["xl/sharedStrings.xml"] === undefined) return [];
  const xml = textFile(files, "xl/sharedStrings.xml");
  return Array.from(xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gu)).map(
    (match) =>
      Array.from((match[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu))
        .map((text) => decodeXml(text[1] ?? ""))
        .join(""),
  );
}

function parseSheetNames(
  files: Readonly<Record<string, Uint8Array>>,
): readonly { readonly name: string; readonly path: string }[] {
  const workbook = textFile(files, "xl/workbook.xml");
  return Array.from(workbook.matchAll(/<sheet\s([^>]*)\/?>/gu)).map(
    (match, index) => ({
      name: attribute(match[1] ?? "", "name") ?? `Sheet ${index + 1}`,
      path: `xl/worksheets/sheet${index + 1}.xml`,
    }),
  );
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "u").exec(attributes);
  return match?.[1] === undefined ? null : decodeXml(match[1]);
}

function elementText(xml: string, name: string): string | null {
  const match = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
    "u",
  ).exec(xml);
  return match?.[1] ?? null;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function cellCoordinates(reference: string): {
  readonly column: number;
  readonly row: number;
} {
  const match = /^([A-Z]+)([1-9][0-9]*)$/u.exec(reference.toUpperCase());
  if (match?.[1] === undefined || match[2] === undefined)
    throw new ParserFailure("INVALID_CELL_REFERENCE");
  let column = 0;
  for (const character of match[1])
    column = column * 26 + character.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}

function columnName(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function safeSpreadsheetDisplay(value: string): string {
  return /^[=+\-@]/u.test(value) ? `'${value}` : value;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? "";
  return (
    [",", "\t", ";"]
      .map((delimiter) => ({
        count: firstLine.split(delimiter).length,
        delimiter,
      }))
      .toSorted((left, right) => right.count - left.count)[0]?.delimiter ?? ","
  );
}

function parseCsv(
  text: string,
  delimiter: string,
  signal?: AbortSignal,
): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (index % 10_000 === 0) signal?.throwIfAborted();
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      if (rows.length > MAX_ROWS)
        throw new ParserFailure("CSV_ROW_LIMIT_EXCEEDED");
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new ParserFailure("MALFORMED_CSV");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function extensionFor(path: string): string {
  const match = /(\.[a-z0-9]+)$/iu.exec(path);
  return match?.[1]?.toLowerCase() ?? "";
}
