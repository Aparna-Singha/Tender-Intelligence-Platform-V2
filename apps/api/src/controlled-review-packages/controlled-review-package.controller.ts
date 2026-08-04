import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  cancelControlledPackageSchema,
  controlledPackagePaginationSchema,
  decideControlledPackageSchema,
  requestControlledPackageDownloadGrantSchema,
  retryControlledPackageSchema,
  revokeControlledPackageSchema,
  startControlledPackageSchema,
  submitControlledPackageReviewSchema,
} from "@tender/contracts";
import type { FastifyReply } from "fastify";

import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { ControlledReviewPackageService } from "./controlled-review-package.service.js";

@ApiCookieAuth("session")
@ApiTags("controlled review packages")
@Controller("organisations/:organisationId/tenders/:tenderId")
export class ControlledReviewPackageController {
  public constructor(
    private readonly packages: ControlledReviewPackageService,
  ) {}

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_PREFLIGHT")
  @Get("controlled-review-packages/preflight")
  @ApiOperation({ summary: "Evaluate controlled-package prerequisites" })
  public preflight(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.packages.preflight(
      organisationId,
      tenderId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_START")
  @Post("controlled-review-packages")
  @HttpCode(202)
  @ApiOperation({ summary: "Start controlled review-package generation" })
  public start(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startControlledPackageSchema.parse(body);
    return this.packages.start(
      organisationId,
      tenderId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_READ")
  @Get("versions/:versionId/controlled-review-packages/current")
  @ApiOperation({ summary: "Read the current controlled package" })
  public current(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.packages.current(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_READ")
  @Get("versions/:versionId/controlled-review-packages")
  @ApiOperation({ summary: "List controlled-package history" })
  public history(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.packages.history(
      organisationId,
      tenderId,
      versionId,
      controlledPackagePaginationSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_READ")
  @Get("controlled-review-packages/:runId")
  @ApiOperation({ summary: "Read controlled-package detail" })
  public detail(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.packages.detail(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_READ")
  @Get("controlled-review-packages/:runId/progress")
  @ApiOperation({ summary: "Read controlled-package lifecycle progress" })
  public progress(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.packages.progress(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_MANIFEST_READ")
  @Get("controlled-review-packages/:runId/manifest")
  @ApiOperation({ summary: "Read safe manifest metadata" })
  public manifest(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.packages.manifest(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_MANIFEST_READ")
  @Get("controlled-review-packages/:runId/provenance")
  @ApiOperation({ summary: "Read typed provenance metadata" })
  public provenance(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.packages.provenance(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_CANCEL")
  @Delete("controlled-review-packages/:runId")
  @ApiOperation({ summary: "Request controlled-package cancellation" })
  public cancel(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = cancelControlledPackageSchema.parse(body);
    return this.packages.cancel(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      input.rationale,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_RETRY")
  @Post("controlled-review-packages/:runId/retry")
  @HttpCode(202)
  @ApiOperation({ summary: "Create an immutable package retry" })
  public retry(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = retryControlledPackageSchema.parse(body);
    return this.packages.retry(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      input.rationale,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_REVIEW")
  @Post("controlled-review-packages/:runId/reviews")
  @ApiOperation({ summary: "Append a controlled-package review" })
  public review(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    if (request.organisationPrincipal === undefined)
      throw new NotFoundException();
    return this.packages.review(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.organisationPrincipal.role,
      submitControlledPackageReviewSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_READ")
  @Get("controlled-review-packages/:runId/reviews")
  @ApiOperation({ summary: "Read append-only package reviews" })
  public reviews(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.packages.reviews(
      organisationId,
      tenderId,
      runId,
      controlledPackagePaginationSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_APPROVE")
  @Post("controlled-review-packages/:runId/decisions")
  @ApiOperation({ summary: "Approve or reject controlled download" })
  public decide(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    if (request.organisationPrincipal === undefined)
      throw new NotFoundException();
    return this.packages.decide(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.organisationPrincipal.role,
      decideControlledPackageSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_READ")
  @Get("controlled-review-packages/:runId/decisions")
  @ApiOperation({ summary: "Read package approval history" })
  public decisions(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.packages.decisions(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_REVOKE")
  @Post("controlled-review-packages/:runId/revocations")
  @ApiOperation({ summary: "Revoke controlled-download approval" })
  public revoke(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    if (request.organisationPrincipal === undefined)
      throw new NotFoundException();
    return this.packages.revoke(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.organisationPrincipal.role,
      revokeControlledPackageSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_DOWNLOAD")
  @Post("controlled-review-packages/:runId/download-grants")
  @ApiOperation({ summary: "Authorise a future controlled download" })
  public grant(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    if (request.organisationPrincipal === undefined)
      throw new NotFoundException();
    return this.packages.grant(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.organisationPrincipal.role,
      requestControlledPackageDownloadGrantSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_DOWNLOAD")
  @Get("controlled-review-packages/:runId/download-grants/:grantId")
  @ApiOperation({ summary: "Redeem an authorised controlled-package download" })
  public redeem(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("grantId") grantId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    reply.header("Cache-Control", "no-store");
    return this.packages.redeem(
      organisationId,
      tenderId,
      runId,
      grantId,
      request.authenticatedUser.userId,
    );
  }

  @RequireOrganisationPermission("TENDER_CONTROLLED_PACKAGE_AUDIT_READ")
  @Get("controlled-review-packages/audit/history")
  @ApiOperation({ summary: "Read bounded controlled-package audit history" })
  public audit(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.packages.audit(
      organisationId,
      tenderId,
      controlledPackagePaginationSchema.parse(query),
    );
  }
}
