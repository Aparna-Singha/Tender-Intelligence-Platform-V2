import { z } from "zod";

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);
const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);
const portSchema = z.coerce.number().int().min(1).max(65_535);
const nonEmptyStringSchema = z.string().trim().min(1);
const urlSchema = z.url();

const serviceBaseSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default("development"),
  LOG_LEVEL: logLevelSchema.default("info"),
  REQUEST_ID_HEADER: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .default("x-request-id"),
});

const dataServicesSchema = z.object({
  DATABASE_URL: z
    .string()
    .trim()
    .startsWith("postgresql://", "DATABASE_URL must use PostgreSQL"),
  REDIS_URL: z
    .string()
    .trim()
    .startsWith("redis://", "REDIS_URL must use Redis"),
});

const objectStorageSchema = z.object({
  S3_ENDPOINT: urlSchema,
  S3_REGION: nonEmptyStringSchema,
  S3_BUCKET: nonEmptyStringSchema,
  S3_ACCESS_KEY_ID: nonEmptyStringSchema,
  S3_SECRET_ACCESS_KEY: nonEmptyStringSchema,
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
});

export const apiEnvironmentSchema = serviceBaseSchema
  .extend({
    API_HOST: nonEmptyStringSchema.default("0.0.0.0"),
    API_PORT: portSchema.default(4000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(10),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(86_400)
      .default(60),
    COOKIE_SECRET: z.string().min(32),
    EMAIL_DELIVERY_TOKEN: z.string().min(16).optional(),
    EMAIL_DELIVERY_URL: urlSchema.optional(),
    EMAIL_FROM: z.email().optional(),
    INVITATION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(2_592_000)
      .default(604_800),
    PASSWORD_RESET_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(86_400)
      .default(3_600),
    SESSION_COOKIE_SECURE: z.stringbool().default(true),
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(900)
      .max(2_592_000)
      .default(604_800),
    TRUST_PROXY: z.stringbool().default(false),
    WEB_APP_URL: urlSchema,
    WEB_ORIGIN: urlSchema,
    QUEUE_NAME: nonEmptyStringSchema.default("platform-jobs"),
    DOCUMENT_UPLOAD_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(900)
      .default(300),
    DOCUMENT_DOWNLOAD_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(300)
      .default(60),
    RAG_PROVIDER: nonEmptyStringSchema.default("gemini"),
    RAG_CHAT_MODEL: nonEmptyStringSchema.default("gemini-2.5-flash"),
    RAG_EMBEDDING_MODEL: nonEmptyStringSchema.default("gemini-embedding-001"),
    RAG_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(30),
  })
  .and(dataServicesSchema)
  .and(objectStorageSchema)
  .superRefine((environment, context) => {
    const deliveryValues = [
      environment.EMAIL_DELIVERY_TOKEN,
      environment.EMAIL_DELIVERY_URL,
      environment.EMAIL_FROM,
    ];
    const configuredValues = deliveryValues.filter(
      (value) => value !== undefined,
    ).length;

    if (configuredValues !== 0 && configuredValues !== deliveryValues.length) {
      context.addIssue({
        code: "custom",
        message:
          "EMAIL_DELIVERY_URL, EMAIL_DELIVERY_TOKEN, and EMAIL_FROM must be configured together",
        path: ["EMAIL_DELIVERY_URL"],
      });
    }

    if (environment.NODE_ENV === "production" && configuredValues === 0) {
      context.addIssue({
        code: "custom",
        message: "Email delivery configuration is required in production",
        path: ["EMAIL_DELIVERY_URL"],
      });
    }
  });

export const workerEnvironmentSchema = serviceBaseSchema
  .extend({
    WORKER_HEALTH_HOST: nonEmptyStringSchema.default("0.0.0.0"),
    WORKER_HEALTH_PORT: portSchema.default(4001),
    QUEUE_NAME: nonEmptyStringSchema.default("platform-jobs"),
    CLAMAV_HOST: nonEmptyStringSchema,
    CLAMAV_PORT: portSchema.default(3310),
    DOCUMENT_JOB_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(60_000),
    EXTRACTION_JOB_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(900_000)
      .default(300_000),
    RAG_JOB_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(900_000)
      .default(180_000),
    GEMINI_API_KEY: z.string().trim().min(16).optional(),
    GEMINI_CHAT_MODEL: nonEmptyStringSchema.default("gemini-2.5-flash"),
    GEMINI_EMBEDDING_MODEL: nonEmptyStringSchema.default(
      "gemini-embedding-001",
    ),
  })
  .and(dataServicesSchema)
  .and(objectStorageSchema);

export const webEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default("development"),
  NEXT_PUBLIC_API_URL: urlSchema,
  WEB_PORT: portSchema.default(3000),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export class EnvironmentValidationError extends Error {
  public constructor(
    public readonly scope: string,
    public readonly issues: readonly string[],
  ) {
    super(`Invalid ${scope} environment:\n${issues.join("\n")}`);
    this.name = "EnvironmentValidationError";
  }
}

export function parseEnvironment<T>(
  scope: string,
  schema: z.ZodType<T>,
  input: NodeJS.ProcessEnv,
): T {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "environment";
    return `${path}: ${issue.message}`;
  });

  throw new EnvironmentValidationError(scope, issues);
}
