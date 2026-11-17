import { Controller, ForbiddenException, Get, Post, Req } from "@nestjs/common";

import { Authenticated } from "./access-control.js";
import type { AuthenticatedRequest } from "./authenticated-request.js";
import {
  MaintenanceService,
  type MaintenanceStatus,
} from "./maintenance.service.js";
import { MaintenanceReconciliationService } from "./maintenance-reconciliation.service.js";

@Authenticated()
@Controller("maintenance")
export class MaintenanceController {
  public constructor(
    private readonly maintenance: MaintenanceService,
    private readonly reconciliation: MaintenanceReconciliationService,
  ) {}

  @Get()
  public status(@Req() request: AuthenticatedRequest): MaintenanceStatus {
    this.requireOperator(request);
    return this.maintenance.status();
  }

  @Post("enable")
  public async enable(
    @Req() request: AuthenticatedRequest,
  ): Promise<MaintenanceStatus> {
    this.requireOperator(request);
    await this.maintenance.setEnabled(true);
    return this.maintenance.status();
  }

  @Post("disable")
  public async disable(
    @Req() request: AuthenticatedRequest,
  ): Promise<MaintenanceStatus> {
    this.requireOperator(request);
    await this.maintenance.setEnabled(false);
    return this.maintenance.status();
  }

  @Get("reconciliation")
  public async reconcile(
    @Req() request: AuthenticatedRequest,
  ): Promise<
    Awaited<ReturnType<MaintenanceReconciliationService["snapshot"]>>
  > {
    this.requireOperator(request);
    return this.reconciliation.snapshot();
  }

  private requireOperator(request: AuthenticatedRequest): void {
    if (request.authenticatedUser.platformRole !== "PLATFORM_ADMIN")
      throw new ForbiddenException();
  }
}
