import { Module } from "@nestjs/common";
import { EligibilityController } from "./eligibility.controller.js";
import { EligibilityService } from "./eligibility.service.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { RequirementEvidenceController } from "./requirement-evidence.controller.js";
import { RequirementEvidenceService } from "./requirement-evidence.service.js";

@Module({
  imports: [DocumentsModule],
  controllers: [EligibilityController, RequirementEvidenceController],
  providers: [EligibilityService, RequirementEvidenceService],
  exports: [EligibilityService],
})
export class EligibilityModule {}
