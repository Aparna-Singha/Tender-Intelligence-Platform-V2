import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@tender/database";

export function isPrismaUniqueConstraintError(
  error: unknown,
  field: string,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = error.meta?.target;
  return Array.isArray(target) && target.includes(field);
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
