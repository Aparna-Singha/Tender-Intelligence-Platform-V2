import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiEnvironment } from "@tender/config";
import { LoggerModule } from "nestjs-pino";

import { HealthModule } from "./health/health.module.js";
import { InfrastructureModule } from "./infrastructure.module.js";
import { API_ENVIRONMENT } from "./infrastructure.tokens.js";
import { AuthModule } from "./auth/auth.module.js";
import { OrganisationsModule } from "./organisations/organisations.module.js";
import { OnboardingModule } from "./onboarding/onboarding.module.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { TendersModule } from "./tenders/tenders.module.js";
import { ExtractionsModule } from "./extractions/extractions.module.js";
import { RisksModule } from "./risks/risks.module.js";
import { EligibilityModule } from "./eligibility/eligibility.module.js";
import { ChecklistsModule } from "./checklists/checklists.module.js";
import { RagModule } from "./rag/rag.module.js";
import { DraftsModule } from "./drafts/drafts.module.js";
import { FinalReadinessModule } from "./final-readiness/final-readiness.module.js";
import {
  AccessGuard,
  CsrfGuard,
  RateLimitGuard,
} from "./common/security.guards.js";
import { RateLimitService } from "./common/rate-limit.service.js";

@Module({
  imports: [
    InfrastructureModule,
    LoggerModule.forRootAsync({
      imports: [InfrastructureModule],
      inject: [API_ENVIRONMENT],
      useFactory: (environment: ApiEnvironment) => ({
        pinoHttp: {
          customProps: () => ({
            environment: environment.NODE_ENV,
            service: "api",
          }),
          level: environment.LOG_LEVEL,
          redact: {
            censor: "[REDACTED]",
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
            ],
          },
        },
      }),
    }),
    HealthModule,
    AuthModule,
    OrganisationsModule,
    OnboardingModule,
    DocumentsModule,
    TendersModule,
    ExtractionsModule,
    RisksModule,
    EligibilityModule,
    ChecklistsModule,
    RagModule,
    DraftsModule,
    FinalReadinessModule,
  ],
  providers: [
    RateLimitService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
