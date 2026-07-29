export const DEMONSTRATION_LABEL =
  "Demonstration tender — not live procurement information.";

export interface TenderSourceInput {
  readonly externalMetadata?: Readonly<
    Record<string, string | number | boolean>
  >;
  readonly provenance: string;
  readonly sourceName: string;
  readonly sourceTenderId?: string;
  readonly sourceUrl?: string;
}

export interface NormalizedTenderSource extends TenderSourceInput {
  readonly adapterType: "ADMIN_IMPORT" | "CURATED_DATASET" | "MANUAL_UPLOAD";
  readonly demonstrationLabel?: typeof DEMONSTRATION_LABEL;
  readonly importMethod: string;
}

export interface TenderSourceAdapter {
  readonly adapterType: NormalizedTenderSource["adapterType"];
  normalize(input: TenderSourceInput): NormalizedTenderSource;
}

export class ManualUploadAdapter implements TenderSourceAdapter {
  public readonly adapterType = "MANUAL_UPLOAD" as const;
  public normalize(input: TenderSourceInput): NormalizedTenderSource {
    return { ...input, adapterType: this.adapterType, importMethod: "MANUAL" };
  }
}

export class CuratedDatasetAdapter implements TenderSourceAdapter {
  public readonly adapterType = "CURATED_DATASET" as const;
  public normalize(input: TenderSourceInput): NormalizedTenderSource {
    return {
      ...input,
      adapterType: this.adapterType,
      demonstrationLabel: DEMONSTRATION_LABEL,
      importMethod: "CURATED_DATASET",
    };
  }
}

export class AdminImportAdapter implements TenderSourceAdapter {
  public readonly adapterType = "ADMIN_IMPORT" as const;
  public normalize(input: TenderSourceInput): NormalizedTenderSource {
    return {
      ...input,
      adapterType: this.adapterType,
      importMethod: "CONTROLLED_ADMIN_IMPORT",
    };
  }
}

export interface ZipEntry {
  readonly compressedSize: number;
  readonly name: string;
  readonly uncompressedSize: number;
}

export function validateZipEntries(entries: readonly ZipEntry[]): void {
  if (entries.length > 200) throw new Error("ZIP_ENTRY_LIMIT");
  let total = 0;
  for (const entry of entries) {
    if (
      entry.name.startsWith("/") ||
      entry.name.startsWith("\\") ||
      entry.name.split(/[\\/]/u).includes("..")
    )
      throw new Error("ZIP_PATH_UNSAFE");
    if (/\.(zip|7z|rar|tar|gz)$/iu.test(entry.name))
      throw new Error("ZIP_NESTED_ARCHIVE");
    if (entry.uncompressedSize > 50 * 1024 * 1024)
      throw new Error("ZIP_ENTRY_SIZE_LIMIT");
    if (
      entry.compressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > 100
    )
      throw new Error("ZIP_COMPRESSION_RATIO");
    total += entry.uncompressedSize;
    if (total > 100 * 1024 * 1024) throw new Error("ZIP_TOTAL_SIZE_LIMIT");
  }
}
