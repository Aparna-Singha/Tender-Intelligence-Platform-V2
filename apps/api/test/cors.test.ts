import helmet from "@fastify/helmet";
import { Controller, Module, Options } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { ApiEnvironment } from "@tender/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { corsOptions } from "../src/cors.js";

const environment = {
  WEB_ORIGIN: "http://localhost:3000",
} as Pick<ApiEnvironment, "WEB_ORIGIN"> as ApiEnvironment;

@Controller("organisations/:organisationId")
class TestOnboardingController {
  @Options("onboarding/steps/:step")
  public preflight(): null {
    return null;
  }
}

@Module({
  controllers: [TestOnboardingController],
})
class TestCorsModule {}

describe("API CORS preflight", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      TestCorsModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.register(helmet, {
      contentSecurityPolicy: false,
    });
    app.enableCors(corsOptions(environment));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows PUT for onboarding preflight while preserving origin, credentials, and security headers", async () => {
    const response = await app.inject({
      headers: {
        "access-control-request-headers": "content-type,x-csrf-token",
        "access-control-request-method": "PUT",
        origin: environment.WEB_ORIGIN,
      },
      method: "OPTIONS",
      url: "/organisations/org-1/onboarding/steps/1?complete=false",
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      environment.WEB_ORIGIN,
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
