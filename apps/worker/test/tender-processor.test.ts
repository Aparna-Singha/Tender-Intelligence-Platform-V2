import { describe, expect, it } from "vitest";
import { readZipDirectory } from "../src/tender-processor.js";

describe("bounded ZIP directory inspection", () => {
  it("rejects data that has no central directory", () => {
    expect(() => readZipDirectory(new Uint8Array([80, 75, 3, 4]))).toThrow(
      "ZIP_DIRECTORY_MISSING",
    );
  });

  it("reads only bounded central directory metadata", () => {
    const data = new Uint8Array(46 + 8);
    const view = new DataView(data.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, 10, true);
    view.setUint32(24, 20, true);
    view.setUint16(28, 8, true);
    data.set(new TextEncoder().encode("file.pdf"), 46);
    expect(readZipDirectory(data)).toEqual([
      { compressedSize: 10, name: "file.pdf", uncompressedSize: 20 },
    ]);
  });
});
