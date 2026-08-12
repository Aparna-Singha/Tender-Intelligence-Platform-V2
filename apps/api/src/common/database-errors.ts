import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@tender/database";

export function isPrismaUniqueConstraintError(
  error: unknown,
  field: string,
): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (isPostgresUniqueConstraintError(error, field)) return true;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") {
    return false;
  }

  if (hasDriverAdapterUniqueField(error.meta, field)) return true;
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === "string") return target.includes(field);
  return false;
}

function hasDriverAdapterUniqueField(meta: unknown, field: string): boolean {
  if (typeof meta !== "object" || meta === null) return false;
  const driverAdapterError =
    "driverAdapterError" in meta ? meta.driverAdapterError : undefined;
  if (typeof driverAdapterError !== "object" || driverAdapterError === null) {
    return false;
  }
  const cause =
    "cause" in driverAdapterError ? driverAdapterError.cause : undefined;
  if (typeof cause !== "object" || cause === null) return false;
  const constraint = "constraint" in cause ? cause.constraint : undefined;
  if (typeof constraint !== "object" || constraint === null) return false;
  const fields = "fields" in constraint ? constraint.fields : undefined;
  return Array.isArray(fields) && fields.includes(field);
}

function isPostgresUniqueConstraintError(
  error: object,
  field: string,
): boolean {
  const code = "code" in error ? error.code : undefined;
  if (code !== "23505") return false;
  const constraint = "constraint" in error ? error.constraint : undefined;
  return typeof constraint === "string" && constraint.includes(field);
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P1000", "P1001", "P1002", "P1008", "P1017"].includes(error.code)
  ) {
    return true;
  }

  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "28P01" ||
    code === "3D000"
  );
}

export function dependencyUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException("A required service is unavailable.");
}
