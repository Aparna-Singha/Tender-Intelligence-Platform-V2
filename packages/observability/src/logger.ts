import pino, { type Logger, type LoggerOptions } from "pino";

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "password",
  "*.password",
  "secret",
  "*.secret",
  "token",
  "*.token",
  "DATABASE_URL",
  "S3_SECRET_ACCESS_KEY",
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
      paths: redactPaths,
      censor: "[REDACTED]",
    },
  };

  return pino(options);
}
