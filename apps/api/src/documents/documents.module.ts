import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";

@Module({ controllers: [DocumentsController], providers: [DocumentsService] })
export class DocumentsModule {}
