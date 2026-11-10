import { z } from "zod";

export const documentCategories = [
  "UDYAM",
  "GST",
  "PAN",
  "CIN",
  "AUDITED_FINANCIAL_STATEMENT",
  "TURNOVER_CERTIFICATE",
  "PURCHASE_ORDER",
  "COMPLETION_CERTIFICATE",
  "EXPERIENCE_CERTIFICATE",
  "OEM_AUTHORISATION",
  "ISO_CERTIFICATE",
  "LICENCE",
  "PRODUCT_DATASHEET",
  "DECLARATION",
  "BANK_DOCUMENT",
  "OTHER",
] as const;

export const documentCategorySchema = z.enum(documentCategories);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

const filenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      value !== "." &&
      value !== ".." &&
      !hasControlCharacter(value),
    "Filename must not contain a path or control characters",
  );

export const createUploadSessionSchema = z.object({
  category: documentCategorySchema,
  checksum_sha256: sha256Schema,
  document_id: z.uuid().optional(),
  expiry_date: z.iso.date().optional(),
  filename: filenameSchema,
  mime_type: z.enum([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  size_bytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
});

export const completeUploadSchema = z.object({
  checksum_sha256: sha256Schema,
});

const evidenceIdempotencyKeySchema = z.string().trim().min(8).max(120);

export const createRequirementUploadSchema = createUploadSessionSchema
  .omit({ category: true, document_id: true })
  .extend({
    category: documentCategorySchema.optional(),
    idempotency_key: evidenceIdempotencyKeySchema,
  });

export const attachRequirementEvidenceSchema = z.object({
  document_id: z.uuid(),
  document_version_id: z.uuid(),
  idempotency_key: evidenceIdempotencyKeySchema,
});

export const evidenceCandidateFilterSchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export type CreateRequirementUploadRequest = z.infer<
  typeof createRequirementUploadSchema
>;
export type AttachRequirementEvidenceRequest = z.infer<
  typeof attachRequirementEvidenceSchema
>;
export type EvidenceCandidateFilter = z.infer<
  typeof evidenceCandidateFilterSchema
>;

export const documentFilterSchema = z.object({
  category: documentCategorySchema.optional(),
  expiring_before: z.iso.date().optional(),
  status: z
    .enum([
      "UPLOADING",
      "UPLOADED",
      "SCANNING",
      "QUARANTINED",
      "PROCESSING",
      "READY",
      "REJECTED",
      "FAILED",
      "EXPIRED",
    ])
    .optional(),
});

export type CreateUploadSessionRequest = z.infer<
  typeof createUploadSessionSchema
>;
export type CompleteUploadRequest = z.infer<typeof completeUploadSchema>;
