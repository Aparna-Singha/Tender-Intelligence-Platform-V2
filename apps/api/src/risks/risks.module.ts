import { Module } from "@nestjs/common";
import { RisksController } from "./risks.controller.js";
import { RisksService } from "./risks.service.js";

@Module({ controllers: [RisksController], providers: [RisksService] })
export class RisksModule {}
