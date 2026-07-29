import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ApiEnvironment } from "@tender/config";

import { API_ENVIRONMENT } from "../infrastructure.tokens.js";

export interface Notification {
  readonly template: "invitation" | "password_reset";
  readonly to: string;
  readonly variables: Readonly<Record<string, string>>;
}

@Injectable()
export class NotificationService {
  public constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  public get isConfigured(): boolean {
    return (
      this.environment.EMAIL_DELIVERY_URL !== undefined &&
      this.environment.EMAIL_DELIVERY_TOKEN !== undefined &&
      this.environment.EMAIL_FROM !== undefined
    );
  }

  public async deliver(notification: Notification): Promise<void> {
    if (
      this.environment.EMAIL_DELIVERY_URL === undefined ||
      this.environment.EMAIL_DELIVERY_TOKEN === undefined ||
      this.environment.EMAIL_FROM === undefined
    ) {
      throw new ServiceUnavailableException("Email delivery unavailable");
    }

    try {
      const response = await fetch(this.environment.EMAIL_DELIVERY_URL, {
        body: JSON.stringify({
          from: this.environment.EMAIL_FROM,
          template: notification.template,
          to: notification.to,
          variables: notification.variables,
        }),
        headers: {
          authorization: `Bearer ${this.environment.EMAIL_DELIVERY_TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error("Delivery provider rejected request");
      }
    } catch {
      throw new ServiceUnavailableException("Email delivery unavailable");
    }
  }
}
