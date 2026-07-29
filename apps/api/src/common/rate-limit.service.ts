import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Redis } from "ioredis";

import { REDIS_CLIENT } from "../infrastructure.tokens.js";

const RATE_LIMIT_SCRIPT =
  'local current=redis.call("INCR",KEYS[1]); if current==1 then redis.call("EXPIRE",KEYS[1],ARGV[1]) end; return current';

@Injectable()
export class RateLimitService {
  public constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  public async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    try {
      if (this.redis.status === "wait") await this.redis.connect();
      const count = await this.redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        `rate-limit:${key}`,
        windowSeconds,
      );
      return Number(count) <= limit;
    } catch {
      throw new ServiceUnavailableException(
        "Authentication service temporarily unavailable",
      );
    }
  }
}
