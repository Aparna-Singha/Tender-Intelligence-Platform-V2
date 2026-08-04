import { HttpException } from "@nestjs/common";
import type { ControlledPackageErrorCode } from "@tender/contracts";

export class ControlledReviewPackageError extends HttpException {
  public constructor(
    public readonly publicCode: ControlledPackageErrorCode,
    message: string,
    status: number,
  ) {
    super({ code: publicCode, message }, status);
  }
}
