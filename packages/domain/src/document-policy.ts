export const MAX_DOCUMENTS_PER_ORGANISATION = 500;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const allowedExtensionsByMime = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
} as const;

export type AllowedDocumentMime = keyof typeof allowedExtensionsByMime;

export function extensionFor(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot < 0 ? "" : filename.slice(lastDot).toLowerCase();
}

export function isAllowedMimeExtension(
  mime: string,
  extension: string,
): boolean {
  const extensions = allowedExtensionsByMime[mime as AllowedDocumentMime] ?? [];
  return (extensions as readonly string[]).includes(extension.toLowerCase());
}

export function canDownloadDocument(status: string): boolean {
  return status === "READY";
}
