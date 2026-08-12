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
import { createApiMetrics, type ApiMetrics } from "@tender/observability";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { ApiResponseInterceptor } from "./common/api-response.interceptor.js";
import { resolveRequestId } from "./common/request-id.js";
import { API_ENVIRONMENT } from "./infrastructure.tokens.js";

const requestStartTimes = new WeakMap<FastifyRequest, bigint>();

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
  const metrics = createApiMetrics();
  const metricsServer = createMetricsServer(metrics);
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
  app.enableCors({
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    origin: environment.WEB_ORIGIN,
  });
  fastify.addHook("onRequest", (request, _reply, done) => {
    requestStartTimes.set(request, process.hrtime.bigint());
    metrics.requestStarted();
    done();
  });
  fastify.addHook("onResponse", (request, reply, done) => {
    const route = getRouteTemplate(request);
    const duration = elapsedSeconds(requestStartTimes.get(request));
    metrics.requestFinished(
      {
        method: request.method,
        route,
        statusCode: reply.statusCode,
      },
      duration,
    );
    if (reply.statusCode === 503) {
      metrics.dependencyUnavailable(route);
    }
    if (reply.statusCode >= 500 && reply.statusCode !== 503) {
      metrics.unexpectedError(route);
    }
    done();
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

  await metricsServer.listen({
    host: environment.API_METRICS_HOST,
    port: environment.API_METRICS_PORT,
  });
  process.once("SIGINT", () => {
    void metricsServer.close();
  });
  process.once("SIGTERM", () => {
    void metricsServer.close();
  });
  try {
    await app.listen({
      host: environment.API_HOST,
      port: environment.API_PORT,
    });
  } catch (error: unknown) {
    await metricsServer.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`API startup failed (${errorType}).\n`);
  process.exitCode = 1;
});

function createMetricsServer(metrics: ApiMetrics): FastifyInstance {
  const server = Fastify({ logger: false });
  server.get("/metrics", async (_request, reply) => {
    void reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });
  return server;
}

function elapsedSeconds(startedAt: bigint | undefined): number {
  if (startedAt === undefined) {
    return 0;
  }
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
}

function getRouteTemplate(request: FastifyRequest): string {
  return (
    request.routeOptions.url ?? normalizePath(request.url.split("?")[0] ?? "/")
  );
}

function normalizePath(path: string): string {
  return path
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:id",
    )
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}
