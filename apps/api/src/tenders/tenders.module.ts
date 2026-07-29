import { Module } from "@nestjs/common";
import { TendersController } from "./tenders.controller.js";
import { TendersService } from "./tenders.service.js";

@Module({ controllers: [TendersController], providers: [TendersService] })
export class TendersModule {}
