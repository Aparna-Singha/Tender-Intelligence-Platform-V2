import { Module } from "@nestjs/common";
import type { ApiEnvironment } from "@tender/config";

import { CookieService } from "../common/cookies.js";
import { InfrastructureModule } from "../infrastructure.module.js";
import { API_ENVIRONMENT } from "../infrastructure.tokens.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { NotificationService } from "./notification.service.js";
import { SessionService } from "./session.service.js";

@Module({
  controllers: [AuthController],
  exports: [CookieService, NotificationService, SessionService],
  imports: [InfrastructureModule],
  providers: [
    AuthService,
    NotificationService,
    SessionService,
    {
      inject: [API_ENVIRONMENT],
      provide: CookieService,
      useFactory: (environment: ApiEnvironment) =>
        new CookieService(environment),
    },
  ],
})
export class AuthModule {}
