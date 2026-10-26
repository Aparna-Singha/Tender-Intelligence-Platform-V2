import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it } from "vitest";

describe("S3 direct upload presigning", () => {
  it("signs SHA-256 metadata as a request header without putting it in the URL", async () => {
    const storage = new S3Client({
      credentials: {
        accessKeyId: "synthetic-access-key",
        secretAccessKey: "synthetic-secret-key",
      },
      endpoint: "https://account.r2.cloudflarestorage.com",
      forcePathStyle: true,
      region: "auto",
    });
    const checksum = "a".repeat(64);

    const signedUrl = await getSignedUrl(
      storage,
      new PutObjectCommand({
        Bucket: "private-test",
        ContentLength: 100,
        ContentType: "application/pdf",
        Key: "quarantine/organisation-a/document-a",
        Metadata: { sha256: checksum },
      }),
      { expiresIn: 300, unhoistableHeaders: new Set(["x-amz-meta-sha256"]) },
    );
    const url = new URL(signedUrl);

    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain(
      "x-amz-meta-sha256",
    );
    expect(url.searchParams.has("x-amz-meta-sha256")).toBe(false);
    expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
    storage.destroy();
  });
});
