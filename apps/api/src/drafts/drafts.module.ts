import { Module } from "@nestjs/common";
import { DraftsController } from "./drafts.controller.js";
import { DraftsService } from "./drafts.service.js";

@Module({
  controllers: [DraftsController],
  providers: [DraftsService],
})
export class DraftsModule {}
