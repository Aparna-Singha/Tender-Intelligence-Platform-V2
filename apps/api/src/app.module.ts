import { Module } from "@nestjs/common";
import type { ApiEnvironment } from "@tender/config";
import { LoggerModule } from "nestjs-pino";

import { HealthModule } from "./health/health.module.js";
import { InfrastructureModule } from "./infrastructure.module.js";
import { API_ENVIRONMENT } from "./infrastructure.tokens.js";

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
  ],
})
export class AppModule {}
