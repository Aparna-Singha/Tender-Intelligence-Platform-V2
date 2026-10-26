import { describe, expect, it, vi } from "vitest";
import { uploadFileToSignedStorageUrl } from "./direct-upload";
import type { DirectUploadError } from "./direct-upload";

describe("direct signed upload", () => {
  it("uploads with the signed SHA-256 metadata header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const uploadUrl =
      "http://minio.local/upload?X-Amz-SignedHeaders=host%3Bx-amz-meta-sha256";
    const checksum = "a".repeat(64);

    const file = new File(["%PDF-1.4 test"], "document.pdf", {
      type: "application/pdf",
    });

    await uploadFileToSignedStorageUrl(uploadUrl, file, checksum);

    expect(fetchMock).toHaveBeenCalledWith(uploadUrl, {
      body: file,
      headers: {
        "content-type": "application/pdf",
        "x-amz-meta-sha256": checksum,
      },
      method: "PUT",
    });
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
        "a".repeat(64),
      ),
    ).rejects.toMatchObject({
      name: "DirectUploadError",
      status: 403,
    } satisfies Partial<DirectUploadError>);
  });
});
