import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  CsvParser,
  DocxParser,
  ParserRegistry,
  PdfParser,
  SpreadsheetParser,
} from "../src/tender-document-parsers.js";
import type { OcrEngine, OcrPageInput, OcrPageOutput } from "@tender/domain";

describe("bounded tender document parsers", () => {
  it("parses CSV deterministically and neutralises spreadsheet formulas", async () => {
    const parsed = await new CsvParser().parse(
      strToU8('Requirement,Value\nCertificate,=HYPERLINK("https://invalid")'),
    );
    expect(parsed.units[0]?.blocks[0]?.table?.cells[3]?.displayedValue).toMatch(
      /^'=HYPERLINK/u,
    );
  });

  it("rejects malformed CSV instead of returning partial safe output", async () => {
    await expect(
      new CsvParser().parse(strToU8('heading,"unterminated')),
    ).rejects.toMatchObject({ code: "MALFORMED_CSV" });
  });

  it("parses synthetic DOCX paragraphs without executing embedded text", async () => {
    const content = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>Bidder shall submit GST certificate</w:t></w:r></w:p></w:body></w:document>",
      ),
    });
    const parsed = await new DocxParser().parse(content);
    expect(parsed.units[0]?.blocks[0]?.text).toContain("GST certificate");
  });

  it("rejects OOXML documents containing a DOCTYPE", async () => {
    const content = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(
        '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><w:document/>',
      ),
    });
    await expect(new DocxParser().parse(content)).rejects.toMatchObject({
      code: "UNSAFE_XML_DOCTYPE",
    });
  });

  it("preserves XLSX cells and formulas as untrusted display text", async () => {
    const content = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "xl/workbook.xml": strToU8(
        '<workbook><sheets><sheet name="Requirements" sheetId="1"/></sheets></workbook>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1"><f>WEBSERVICE("https://invalid")</f><v>0</v></c></row></sheetData></worksheet>',
      ),
    });
    const parsed = await new SpreadsheetParser().parse(content);
    expect(parsed.units[0]?.blocks[0]?.table?.cells[0]).toMatchObject({
      cellReference: "A1",
      formulaText: 'WEBSERVICE("https://invalid")',
    });
  });

  it("processes supported ZIP members and reports unsupported members", async () => {
    const content = zipSync({
      "requirements.csv": strToU8("name,value\nEMD,required"),
      "readme.txt": strToU8("not an approved tender format"),
    });
    const parsed = await new ParserRegistry().parse(".zip", content);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ issueType: "UNSUPPORTED_FORMAT" }),
    );
  });

  it("does not OCR searchable PDF pages with adequate embedded text", async () => {
    const ocr = fakeOcr();
    const parsed = await new PdfParser(ocr).parse(
      await searchablePdf([
        "Tender ID: TIP-2026-001. Buyer: Synthetic City Council. Bid deadline: 31 August 2026.",
      ]),
    );

    expect(ocr.calls).toEqual([]);
    expect(parsed.units[0]).toMatchObject({
      ocrStatus: "NOT_REQUIRED",
      unitIndex: 1,
    });
  });

  it("OCRs scanned PDF pages and preserves page provenance", async () => {
    const ocr = fakeOcr([
      {
        confidence: 0.91,
        text: "Tender ID: OCR-2026-001. Buyer: Synthetic Water Board. Bidder shall submit ISO certificate.",
      },
    ]);

    const parsed = await new PdfParser(ocr).parse(
      await scannedPdf(["Synthetic scanned tender page"]),
    );

    expect(ocr.calls).toEqual([1]);
    expect(parsed.units[0]).toMatchObject({
      confidence: "HIGH",
      ocrConfidence: 0.91,
      ocrEngine: "fake-ocr",
      ocrStatus: "OCR_PERFORMED",
      unitIndex: 1,
    });
    expect(parsed.units[0]?.blocks[0]?.text).toContain("OCR-2026-001");
  });

  it("OCRs only scanned pages in a mixed PDF", async () => {
    const ocr = fakeOcr([
      {
        confidence: 0.72,
        text: "Page two OCR text. Experience: 3 years similar work required.",
      },
    ]);

    const parsed = await new PdfParser(ocr).parse(
      await mixedPdf([
        "Page one searchable text with tender identifier MIX-1.",
        "Page two scanned image",
        "Page three searchable text with bid security requirement.",
      ]),
    );

    expect(ocr.calls).toEqual([2]);
    expect(parsed.units.map((unit) => unit.ocrStatus)).toEqual([
      "NOT_REQUIRED",
      "OCR_PERFORMED",
      "NOT_REQUIRED",
    ]);
    expect(parsed.units[1]?.confidence).toBe("MEDIUM");
  });

  it("keeps OCR failures review-safe instead of returning empty success", async () => {
    const parsed = await new PdfParser(failingOcr()).parse(
      await scannedPdf(["Unreadable scan"]),
    );

    expect(parsed.units[0]).toMatchObject({
      confidence: "HUMAN_REVIEW_REQUIRED",
      ocrStatus: "OCR_FAILED",
    });
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        issueType: "OCR_UNAVAILABLE",
        requiresHumanReview: true,
        unitIndex: 1,
      }),
    );
  });
});

function fakeOcr(
  outputs: readonly Pick<OcrPageOutput, "confidence" | "text">[] = [],
): OcrEngine & { readonly calls: number[] } {
  const calls: number[] = [];
  return {
    available: true,
    calls,
    recognize(input: OcrPageInput): Promise<OcrPageOutput> {
      calls.push(input.pageNumber);
      const output = outputs[calls.length - 1] ?? {
        confidence: 0.9,
        text: "Synthetic OCR text",
      };
      return Promise.resolve({
        ...output,
        engineName: "fake-ocr",
        engineVersion: "1",
        language: "eng",
      });
    },
  };
}

function failingOcr(): OcrEngine {
  return {
    available: true,
    recognize(): Promise<OcrPageOutput> {
      return Promise.reject(new Error("OCR_TIMEOUT"));
    },
  };
}

async function searchablePdf(lines: readonly string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const line of lines) {
    const page = pdf.addPage([612, 792]);
    page.drawText(line, { font, size: 12, x: 72, y: 720 });
  }
  return pdf.save();
}

async function scannedPdf(labels: readonly string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const label of labels) {
    const page = pdf.addPage([612, 792]);
    drawScannedLikeImage(page, label);
  }
  return pdf.save();
}

async function mixedPdf(
  labels: readonly [string, string, string],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageOne = pdf.addPage([612, 792]);
  pageOne.drawText(labels[0], { font, size: 12, x: 72, y: 720 });
  const pageTwo = pdf.addPage([612, 792]);
  drawScannedLikeImage(pageTwo, labels[1]);
  const pageThree = pdf.addPage([612, 792]);
  pageThree.drawText(labels[2], { font, size: 12, x: 72, y: 720 });
  return pdf.save();
}

function drawScannedLikeImage(
  page: ReturnType<PDFDocument["addPage"]>,
  label: string,
): void {
  page.drawRectangle({
    color: rgb(0.95, 0.95, 0.95),
    height: 420,
    width: 500,
    x: 56,
    y: 230,
  });
  page.drawRectangle({
    borderColor: rgb(0.1, 0.1, 0.1),
    borderWidth: 2,
    height: 420,
    width: 500,
    x: 56,
    y: 230,
  });
  for (let index = 0; index < label.length; index += 1) {
    const x = 90 + (index % 30) * 12;
    const y = 560 - Math.floor(index / 30) * 32;
    page.drawRectangle({
      color: rgb(0.05, 0.05, 0.05),
      height: 18,
      width: label.charCodeAt(index) % 2 === 0 ? 7 : 10,
      x,
      y,
    });
  }
}
