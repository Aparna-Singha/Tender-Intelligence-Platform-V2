import { z } from "zod";

export const tenderSourceTypes = [
  "MANUAL_UPLOAD",
  "CURATED_DATASET",
  "ADMIN_IMPORT",
] as const;
export const tenderDocumentRoles = [
  "PRIMARY",
  "ANNEXURE",
  "BOQ",
  "SUPPORTING",
  "TECHNICAL_SPECIFICATION",
  "FORM",
  "DECLARATION",
  "CORRIGENDUM",
  "AMENDMENT",
  "CLARIFICATION",
] as const;

const safeFilename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      value !== "." &&
      value !== "..",
    "Filename must not contain a path",
  );
const optionalUrl = z.url().startsWith("https://").optional();
const metadataValue = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
]);

const tenderFieldsSchema = z.object({
  buyer: z.string().trim().min(2).max(240),
  category: z.string().trim().max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  official_source_url: optionalUrl,
  opening_date: z.iso.datetime({ offset: true }).optional(),
  pre_bid_meeting_date: z.iso.datetime({ offset: true }).optional(),
  procurement_type: z.string().trim().max(80).optional(),
  publication_date: z.iso.date().optional(),
  source_tender_number: z.string().trim().max(160).optional(),
  submission_deadline: z.iso.datetime({ offset: true }),
  title: z.string().trim().min(3).max(300),
});

export const createTenderSchema = tenderFieldsSchema.refine(
  (value) =>
    value.publication_date === undefined ||
    new Date(value.publication_date) <= new Date(value.submission_deadline),
  { message: "Publication date must not follow the deadline" },
);

export const updateTenderSchema = tenderFieldsSchema
  .partial()
  .refine(
    (value) =>
      value.publication_date === undefined ||
      value.submission_deadline === undefined ||
      new Date(value.publication_date) <= new Date(value.submission_deadline),
    { message: "Publication date must not follow the deadline" },
  );

export const createTenderUploadSchema = z.object({
  checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  filename: safeFilename,
  mime_type: z.enum([
    "application/pdf",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/csv",
  ]),
  role: z.enum(tenderDocumentRoles),
  size_bytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
});

export const completeTenderUploadSchema = z.object({
  checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const createCorrigendumSchema = z.object({
  checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  description: z.string().trim().min(2).max(2000),
  identifier: z.string().trim().min(1).max(160),
  publication_date: z.iso.date().optional(),
  source_url: optionalUrl,
});

export const importTenderSchema = z.object({
  adapter_type: z.enum(["CURATED_DATASET", "ADMIN_IMPORT"]),
  external_metadata: z.record(z.string().max(80), metadataValue).optional(),
  metadata: createTenderSchema,
  provenance: z.string().trim().min(3).max(1000),
  source_name: z.string().trim().min(2).max(160),
});

export type CreateTenderRequest = z.infer<typeof createTenderSchema>;
export type UpdateTenderRequest = z.infer<typeof updateTenderSchema>;
export type CreateTenderUploadRequest = z.infer<
  typeof createTenderUploadSchema
>;
export type CreateCorrigendumRequest = z.infer<typeof createCorrigendumSchema>;
export type ImportTenderRequest = z.infer<typeof importTenderSchema>;
