import { describe, expect, it } from "vitest";
import {
  selectTenderFiles,
  tenderUploadMimeType,
  validateTenderFileSelection,
} from "./tender-upload-files";

const makeFile = (name: string, bytes = 1): File =>
  new File([new Uint8Array(bytes)], name);

describe("manual GeM tender bundle selection", () => {
  it("assigns the main PDF and common GeM attachments separate roles", () => {
    const files = [
      makeFile("ATC_conditions.pdf"),
      makeFile("GEM_2026_B_1234567_bid.pdf"),
      makeFile("product_specification.pdf"),
      makeFile("boq.xlsx"),
      makeFile("item_sample.csv"),
    ];
    expect(selectTenderFiles(files, false).map(({ role }) => role)).toEqual([
      "ANNEXURE",
      "PRIMARY",
      "TECHNICAL_SPECIFICATION",
      "BOQ",
      "BOQ",
    ]);
    expect(selectTenderFiles(files, true)[1]?.role).toBe("SUPPORTING");
  });

  it("normalizes file types when browsers report blank or inconsistent MIME", () => {
    expect(tenderUploadMimeType("BoQ.CSV")).toBe("text/csv");
    expect(tenderUploadMimeType("attachment.xlsx")).toContain("spreadsheetml");
    expect(tenderUploadMimeType("tender.pdf")).toBe("application/pdf");
    expect(tenderUploadMimeType("virus.exe")).toBeNull();
  });

  it("preflights unsupported files, empty files and the API size limit", () => {
    expect(validateTenderFileSelection([])).toMatch(/Select at least one/);
    expect(
      validateTenderFileSelection(
        selectTenderFiles([makeFile("file.exe")], false),
      ),
    ).toMatch(/Unsupported file type/);
    expect(
      validateTenderFileSelection(
        selectTenderFiles([makeFile("empty.pdf", 0)], false),
      ),
    ).toMatch(/is empty/);
    expect(
      validateTenderFileSelection(
        selectTenderFiles([makeFile("huge.pdf", 25 * 1024 * 1024 + 1)], false),
      ),
    ).toMatch(/25 MB/);
    expect(
      validateTenderFileSelection(
        selectTenderFiles([makeFile("tender.pdf"), makeFile("atc.pdf")], false),
      ),
    ).toBeNull();
  });

  it("does not accept a spreadsheet as the primary bid document", () => {
    const [selection] = selectTenderFiles([makeFile("boq.xlsx")], false);
    if (selection === undefined) throw new Error("Expected BOQ file");
    expect(
      validateTenderFileSelection([{ ...selection, role: "PRIMARY" }]),
    ).toMatch(/must be a PDF/);
  });
});
