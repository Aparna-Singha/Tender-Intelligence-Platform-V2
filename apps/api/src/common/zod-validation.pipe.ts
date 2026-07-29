import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  public constructor(private readonly schema: z.ZodType<T>) {}

  public transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException("Invalid request");
    }
    return result.data;
  }
}
