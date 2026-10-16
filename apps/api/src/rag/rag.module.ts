import { Module } from "@nestjs/common";
import { RagController } from "./rag.controller.js";
import { RagService } from "./rag.service.js";
import { ConversationsController } from "./conversations.controller.js";
import { ConversationsService } from "./conversations.service.js";

@Module({
  controllers: [RagController, ConversationsController],
  providers: [RagService, ConversationsService],
  exports: [RagService],
})
export class RagModule {}
