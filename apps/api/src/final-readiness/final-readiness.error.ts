import { HttpException, type HttpStatus } from "@nestjs/common";
import type { FinalReadinessErrorCode } from "@tender/contracts";

export class FinalReadinessError extends HttpException {
  public constructor(
    public readonly publicCode: FinalReadinessErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super(message, status);
  }
}
