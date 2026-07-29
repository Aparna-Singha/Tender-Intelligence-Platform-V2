import { Module } from "@nestjs/common";
import { ExtractionsController } from "./extractions.controller.js";
import { ExtractionsService } from "./extractions.service.js";

@Module({
  controllers: [ExtractionsController],
  providers: [ExtractionsService],
})
export class ExtractionsModule {}
