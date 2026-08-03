import { Module } from "@nestjs/common";
import { FinalReadinessController } from "./final-readiness.controller.js";
import { FinalReadinessFreshnessService } from "./final-readiness-freshness.service.js";
import { FinalReadinessService } from "./final-readiness.service.js";

@Module({
  controllers: [FinalReadinessController],
  providers: [FinalReadinessFreshnessService, FinalReadinessService],
})
export class FinalReadinessModule {}
