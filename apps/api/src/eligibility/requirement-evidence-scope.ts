import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@tender/database";

export interface RequirementScope {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly tenderVersionId: string;
  readonly requirementId: string;
}

/** Locks the current tender and version while an evidence mutation commits. */
export async function assertCurrentRequirement(
  tx: Prisma.TransactionClient,
  scope: RequirementScope,
): Promise<string> {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM tenders WHERE id=${scope.tenderId}::uuid AND organisation_id=${scope.organisationId}::uuid FOR SHARE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM tender_versions WHERE id=${scope.tenderVersionId}::uuid AND tender_id=${scope.tenderId}::uuid FOR SHARE`,
  );
  const version = await tx.tenderVersion.findFirst({
    select: {
      activeExtractionRun: {
        select: { id: true, invalidatedAt: true, status: true },
      },
    },
    where: {
      id: scope.tenderVersionId,
      tender: {
        currentVersionId: scope.tenderVersionId,
        deletedAt: null,
        id: scope.tenderId,
        organisationId: scope.organisationId,
      },
    },
  });
  const extraction = version?.activeExtractionRun;
  if (extraction?.status !== "COMPLETE" || extraction.invalidatedAt !== null)
    throw new NotFoundException();
  const requirement = await tx.structuredRequirement.findFirst({
    select: { id: true },
    where: {
      extractionRunId: extraction.id,
      findingState: "FOUND",
      id: scope.requirementId,
      reviewState: { not: "REJECTED" },
    },
  });
  if (requirement === null) throw new NotFoundException();
  return extraction.id;
}
