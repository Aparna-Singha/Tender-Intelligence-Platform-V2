import { createWorker, PSM } from "tesseract.js";
import type { OcrEngine, OcrPageInput, OcrPageOutput } from "@tender/domain";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

export const OCR_POLICY_VERSION = "tesseract-local-v1";
export const OCR_LANGUAGE = "eng";
export const OCR_PAGE_TIMEOUT_MS = 30_000;
const require = createRequire(import.meta.url);
const tesseractCorePath = dirname(require.resolve("tesseract.js-core"));
const trainedDataPath = join(
  dirname(require.resolve("@tesseract.js-data/eng")),
  "4.0.0",
);

export class TesseractOcrEngine implements OcrEngine {
  public readonly available = true;

  public async recognize(
    input: OcrPageInput,
    signal?: AbortSignal,
  ): Promise<OcrPageOutput> {
    signal?.throwIfAborted();
    const worker = await createWorker(OCR_LANGUAGE, 1, {
      cacheMethod: "none",
      corePath: tesseractCorePath,
      langPath: trainedDataPath,
      logger: () => undefined,
      workerBlobURL: false,
    });
    try {
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: PSM.AUTO,
        user_defined_dpi: "144",
      });
      const result = await withTimeout(
        worker.recognize(Buffer.from(input.image), undefined, {
          blocks: true,
          text: true,
        }),
        OCR_PAGE_TIMEOUT_MS,
        signal,
      );
      return {
        confidence: Math.max(0, Math.min(1, result.data.confidence / 100)),
        engineName: "tesseract.js",
        engineVersion: result.data.version,
        language: OCR_LANGUAGE,
        text: result.data.text.replace(/\s+/gu, " ").trim(),
      };
    } finally {
      await worker.terminate();
    }
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("OCR_TIMEOUT")), timeoutMs);
    signal?.addEventListener(
      "abort",
      () => reject(new Error("OCR_CANCELLED")),
      { once: true },
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
