export class DirectUploadError extends Error {
  public constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "DirectUploadError";
  }
}

export async function uploadFileToSignedStorageUrl(
  uploadUrl: string,
  file: File,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      body: file,
      headers: {
        "content-type": file.type || "application/octet-stream",
      },
      method: "PUT",
    });
  } catch {
    throw new DirectUploadError(
      "The secure storage service could not be reached.",
    );
  }

  if (!response.ok) {
    throw new DirectUploadError(
      "The secure storage service rejected the upload.",
      response.status,
    );
  }
}
