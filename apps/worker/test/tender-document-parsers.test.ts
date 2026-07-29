import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  CsvParser,
  DocxParser,
  ParserRegistry,
  SpreadsheetParser,
} from "../src/tender-document-parsers.js";

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
});
