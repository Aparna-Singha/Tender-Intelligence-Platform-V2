import { Module } from "@nestjs/common";
import { EligibilityController } from "./eligibility.controller.js";
import { EligibilityService } from "./eligibility.service.js";

@Module({
  controllers: [EligibilityController],
  providers: [EligibilityService],
})
export class EligibilityModule {}
