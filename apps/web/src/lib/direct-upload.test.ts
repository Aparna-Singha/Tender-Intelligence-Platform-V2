import { describe, expect, it, vi } from "vitest";
import {
  uploadFileToSignedStorageUrl,
} from "./direct-upload";
import type { DirectUploadError } from "./direct-upload";

describe("direct signed upload", () => {
  it("uploads with only the signed content-type header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    const file = new File(["%PDF-1.4 test"], "document.pdf", {
      type: "application/pdf",
    });

    await uploadFileToSignedStorageUrl("http://minio.local/upload", file);

    expect(fetchMock).toHaveBeenCalledWith("http://minio.local/upload", {
      body: file,
      headers: {
        "content-type": "application/pdf",
      },
      method: "PUT",
    });
    expect(
      (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)
        ?.headers,
    ).not.toHaveProperty("x-amz-meta-sha256");
  });

  it("throws a direct-upload error when storage rejects the upload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
    } as Response);

    await expect(
      uploadFileToSignedStorageUrl(
        "http://minio.local/upload",
        new File(["content"], "document.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toMatchObject({
      name: "DirectUploadError",
      status: 403,
    } satisfies Partial<DirectUploadError>);
  });
});
