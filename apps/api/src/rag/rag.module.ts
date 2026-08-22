import { Module } from "@nestjs/common";
import { RagController } from "./rag.controller.js";
import { RagService } from "./rag.service.js";

@Module({
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
