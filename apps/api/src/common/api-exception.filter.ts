import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { ApiErrorResponse } from "@tender/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

const publicErrors: Readonly<
  Record<number, { readonly code: string; readonly message: string }>
> = {
  [HttpStatus.BAD_REQUEST]: {
    code: "BAD_REQUEST",
    message: "The request is invalid.",
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: "UNAUTHORIZED",
    message: "Authentication is required.",
  },
  [HttpStatus.FORBIDDEN]: {
    code: "FORBIDDEN",
    message: "The operation is not permitted.",
  },
  [HttpStatus.NOT_FOUND]: {
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
  },
  [HttpStatus.METHOD_NOT_ALLOWED]: {
    code: "METHOD_NOT_ALLOWED",
    message: "The request method is not allowed.",
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: "RATE_LIMITED",
    message: "Too many requests.",
  },
  [HttpStatus.CONFLICT]: {
    code: "CONFLICT",
    message: "The request conflicts with the current state.",
  },
  [HttpStatus.UNPROCESSABLE_ENTITY]: {
    code: "UNPROCESSABLE_ENTITY",
    message: "The request could not be processed.",
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: "SERVICE_UNAVAILABLE",
    message: "The service is not ready.",
  },
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const safeError = publicErrors[status] ?? {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    };
    const body: ApiErrorResponse = {
      error: safeError,
      request_id: request.id,
    };

    if (status >= 500) {
      request.log.error(
        {
          error_type:
            exception instanceof Error ? exception.name : "UnknownException",
        },
        "Request failed",
      );
    }

    void reply.status(status).send(body);
  }
}
