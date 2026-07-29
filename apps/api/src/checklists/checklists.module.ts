import { Module } from "@nestjs/common";
import { ChecklistsController } from "./checklists.controller.js";
import { ChecklistsService } from "./checklists.service.js";

@Module({
  controllers: [ChecklistsController],
  providers: [ChecklistsService],
})
export class ChecklistsModule {}
