import { Module } from "@nestjs/common";
import { ChecklistsModule } from "../checklists/checklists.module.js";
import { EligibilityModule } from "../eligibility/eligibility.module.js";
import { ExtractionsModule } from "../extractions/extractions.module.js";
import { RagModule } from "../rag/rag.module.js";
import { RisksModule } from "../risks/risks.module.js";
import { TenderAnalysisOrchestratorService } from "./tender-analysis-orchestrator.service.js";
import { TendersController } from "./tenders.controller.js";
import { TendersService } from "./tenders.service.js";

@Module({
  imports: [
    ExtractionsModule,
    RisksModule,
    EligibilityModule,
    ChecklistsModule,
    RagModule,
  ],
  controllers: [TendersController],
  providers: [TenderAnalysisOrchestratorService, TendersService],
})
export class TendersModule {}
