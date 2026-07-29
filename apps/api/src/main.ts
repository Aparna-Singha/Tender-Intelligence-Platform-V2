import "reflect-metadata";

import type { IncomingMessage } from "node:http";

import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import {
  apiEnvironmentSchema,
  parseEnvironment,
  type ApiEnvironment,
} from "@tender/config";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { ApiResponseInterceptor } from "./common/api-response.interceptor.js";
import { resolveRequestId } from "./common/request-id.js";
import { API_ENVIRONMENT } from "./infrastructure.tokens.js";

async function bootstrap(): Promise<void> {
  const startupEnvironment = parseEnvironment(
    "api",
    apiEnvironmentSchema,
    process.env,
  );
  const adapter = new FastifyAdapter({
    genReqId: (request: IncomingMessage) =>
      resolveRequestId(request.headers[startupEnvironment.REQUEST_ID_HEADER]),
    trustProxy: startupEnvironment.TRUST_PROXY,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      bufferLogs: true,
    },
  );
  const environment = app.get<ApiEnvironment>(API_ENVIRONMENT);

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
  app.enableCors({
    credentials: true,
    origin: environment.WEB_ORIGIN,
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle("Tender Intelligence Platform API")
    .setDescription(
      "Authentication and organisation API for Tender Intelligence Platform.",
    )
    .setVersion("0.2.0")
    .addCookieAuth("tip_session", { in: "cookie", type: "apiKey" }, "session")
    .build();
  SwaggerModule.setup(
    "openapi",
    app,
    SwaggerModule.createDocument(app, openApiConfig),
  );

  await app.listen({
    host: environment.API_HOST,
    port: environment.API_PORT,
  });
}

void bootstrap().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`API startup failed (${errorType}).\n`);
  process.exitCode = 1;
});
