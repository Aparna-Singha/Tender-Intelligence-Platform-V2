export const tenderFileRoleOptions = [
  { label: "Primary bid document", value: "PRIMARY" },
  { label: "ATC / annexure", value: "ANNEXURE" },
  { label: "Technical specification", value: "TECHNICAL_SPECIFICATION" },
  { label: "Bill of quantities (BOQ)", value: "BOQ" },
  { label: "Form", value: "FORM" },
  { label: "Declaration", value: "DECLARATION" },
  { label: "Supporting document", value: "SUPPORTING" },
  { label: "Buyer clarification", value: "CLARIFICATION" },
] as const;

export type TenderFileRole = (typeof tenderFileRoleOptions)[number]["value"];

export interface SelectedTenderFile {
  readonly file: File;
  readonly mimeType: string | null;
  readonly role: TenderFileRole;
}

const mimeTypes: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

export const MAX_TENDER_FILE_BYTES = 25 * 1024 * 1024;

export function tenderUploadMimeType(filename: string): string | null {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return mimeTypes[extension] ?? null;
}

export function selectTenderFiles(
  files: readonly File[],
  hasExistingPrimary: boolean,
): readonly SelectedTenderFile[] {
  const primaryIndex = hasExistingPrimary
    ? -1
    : files.findIndex(
        (file) =>
          tenderUploadMimeType(file.name) === "application/pdf" &&
          !/(?:atc|annex|specif|corrigend|amend|clarif|declar|form)/i.test(
            file.name,
          ),
      );

  return files.map((file, index) => {
    const mimeType = tenderUploadMimeType(file.name);
    const role: TenderFileRole =
      index === primaryIndex
        ? "PRIMARY"
        : mimeType === "text/csv" ||
            mimeType ===
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
            /\bboq\b/i.test(file.name)
          ? "BOQ"
          : /specif/i.test(file.name)
            ? "TECHNICAL_SPECIFICATION"
            : /(?:atc|annex)/i.test(file.name) || mimeType === "application/zip"
              ? "ANNEXURE"
              : "SUPPORTING";
    return { file, mimeType, role };
  });
}

export function validateTenderFileSelection(
  selected: readonly (Omit<SelectedTenderFile, "role"> & {
    readonly role: TenderFileRole | "CORRIGENDUM";
  })[],
): string | null {
  if (selected.length === 0) return "Select at least one tender document.";
  if (selected.filter(({ role }) => role === "PRIMARY").length > 1)
    return "Select only one primary bid document in this batch.";
  for (const { file, mimeType, role } of selected) {
    if (mimeType === null)
      return `Unsupported file type for "${file.name}". Use PDF, ZIP, XLSX, DOCX, or CSV.`;
    if (file.size === 0) return `"${file.name}" is empty.`;
    if (file.size > MAX_TENDER_FILE_BYTES)
      return `"${file.name}" exceeds the 25 MB per-file limit.`;
    if (role === "PRIMARY" && mimeType !== "application/pdf")
      return "The primary GeM bid document must be a PDF.";
  }
  return null;
}
