import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
