import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Liveness, Readiness } from "@tender/contracts";
import type { FastifyReply } from "fastify";

import { HealthService } from "./health.service.js";
import { Public } from "../common/access-control.js";

@ApiTags("platform")
@Public()
@Controller()
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  @Get("health")
  @ApiOperation({ summary: "API process liveness" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "The API process is alive.",
  })
  public health(): Liveness {
    return {
      service: "api",
      status: "ok",
    };
  }

  @Get("ready")
  @ApiOperation({ summary: "API dependency readiness" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "All dependencies are ready.",
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: "At least one required dependency is unavailable.",
  })
  public async ready(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Readiness> {
    const readiness = await this.healthService.readiness();

    if (readiness.status === "not_ready") {
      void reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return readiness;
  }
}
