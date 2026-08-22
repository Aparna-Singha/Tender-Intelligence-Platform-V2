import pino, { type Logger, type LoggerOptions } from "pino";

export const redactionPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-csrf-token",
  "req.headers.x-xsrf-token",
  "req.body",
  "res.headers.set-cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "request.headers.x-csrf-token",
  "request.headers.x-xsrf-token",
  "request.body",
  "response.headers.set-cookie",
  "body",
  "password",
  "*.password",
  "*.*.password",
  "secret",
  "*.secret",
  "*.*.secret",
  "token",
  "*.token",
  "*.*.token",
  "csrfToken",
  "*.csrfToken",
  "csrf",
  "*.csrf",
  "apiKey",
  "*.apiKey",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "signedUrl",
  "*.signedUrl",
  "url",
  "*.url",
  "objectKey",
  "*.objectKey",
  "prompt",
  "*.prompt",
  "sourceText",
  "*.sourceText",
  "documentText",
  "*.documentText",
  "DATABASE_URL",
  "*.DATABASE_URL",
  "S3_ACCESS_KEY_ID",
  "*.S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "*.S3_SECRET_ACCESS_KEY",
  "GEMINI_API_KEY",
  "*.GEMINI_API_KEY",
];

export interface LoggerConfiguration {
  readonly level: string;
  readonly service: string;
  readonly environment: string;
}

export function createLogger(configuration: LoggerConfiguration): Logger {
  const options: LoggerOptions = {
    base: {
      environment: configuration.environment,
      service: configuration.service,
    },
    level: configuration.level,
    redact: {
      paths: redactionPaths,
      censor: "[REDACTED]",
    },
  };

  return pino(options);
}
