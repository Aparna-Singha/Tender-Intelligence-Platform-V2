import { HttpException, type HttpStatus } from "@nestjs/common";

export type DocumentUploadErrorCode =
  "DOCUMENT_DUPLICATE" | "DOCUMENT_LIMIT_REACHED";

export class DocumentUploadError extends HttpException {
  public constructor(
    public readonly publicCode: DocumentUploadErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super(message, status);
  }
}
