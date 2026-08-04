import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { createHash } from "node:crypto";

export const CONTROLLED_PACKAGE_RENDERER_VERSION =
  "controlled-review-package-renderer-compatibility-v1" as const;

export type ControlledPackageRendererFailureCode =
  | "RENDERER_COMPATIBILITY_MISMATCH"
  | "RENDERER_INPUT_INVALID"
  | "RENDERER_PAGE_LIMIT_EXCEEDED"
  | "RENDERER_PDF_SIZE_LIMIT_EXCEEDED"
  | "RENDERER_UNSUPPORTED_TEXT";

export class ControlledPackageRendererError extends Error {
  constructor(readonly code: ControlledPackageRendererFailureCode) {
    super(code);
    this.name = "ControlledPackageRendererError";
  }
}

export interface ControlledPackageRenderItem {
  readonly provenanceHandles: readonly string[];
  readonly text: string;
  readonly title: string;
}

export interface ControlledPackageRenderInput {
  readonly canonicalRenderTimestamp: string;
  readonly checklist: readonly ControlledPackageRenderItem[];
  readonly draftSections: readonly {
    readonly heading: string;
    readonly text: string;
  }[];
  readonly finalReadinessFindings: readonly ControlledPackageRenderItem[];
  readonly finalRiskFindings: readonly ControlledPackageRenderItem[];
  readonly packageId: string;
  readonly packageTitle: string;
  readonly policyVersion: "controlled-review-package-deterministic-v1";
  readonly provenanceHandles: readonly string[];
  readonly rendererCompatibilityVersion: typeof CONTROLLED_PACKAGE_RENDERER_VERSION;
  readonly tenderIdentifiers: readonly string[];
  readonly warnings: readonly ControlledPackageRenderItem[];
}

export interface ControlledPackageRenderOutput {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
  readonly sha256: string;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const FONT_SIZE = 10;
const LINE_HEIGHT = 14;
const MAX_PAGES = 2_000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_FIELD = 100_000;

export async function renderControlledPackagePdf(
  input: ControlledPackageRenderInput,
): Promise<ControlledPackageRenderOutput> {
  validateInput(input);
  const document = await PDFDocument.create();
  const timestamp = new Date(input.canonicalRenderTimestamp);
  document.setTitle("Controlled review package");
  document.setAuthor("Tender Intelligence Platform");
  document.setSubject(
    "Controlled human review only; not approved for submission",
  );
  document.setCreator("controlled-review-package-renderer-compatibility-v1");
  document.setProducer("controlled-review-package-renderer-compatibility-v1");
  document.setCreationDate(timestamp);
  document.setModificationDate(timestamp);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  const writer = new PdfWriter(document, regular, bold);
  writer.heading("Controlled review package", 20);
  writer.lines([
    `Package: ${input.packageTitle}`,
    `Package ID: ${input.packageId}`,
    ...input.tenderIdentifiers.map((value) => `Tender identifier: ${value}`),
    `Generated: ${input.canonicalRenderTimestamp}`,
    `Policy: ${input.policyVersion}`,
    `Renderer: ${input.rendererCompatibilityVersion}`,
    "CONFIDENTIAL — AUTHORISED HUMAN REVIEW ONLY",
    "This package is not approval to submit and does not submit to any procurement portal.",
    "It is not legal, compliance, eligibility, completeness, or bid-success certification.",
    "The product is independent and is not affiliated with GeM, CPPP, or a government authority.",
  ]);
  writer.pageBreak();
  writer.heading("Contents", 16);
  writer.lines([
    "1. Approved consolidated draft",
    "2. Package warnings",
    "3. Final readiness findings",
    "4. Final risk findings",
    "5. Checklist",
    "6. Provenance handles",
  ]);
  renderSections(
    writer,
    "Approved consolidated draft",
    input.draftSections.map(({ heading, text }) => ({
      title: heading,
      text,
      provenanceHandles: [],
    })),
  );
  renderSections(writer, "Package warnings", input.warnings);
  renderSections(
    writer,
    "Final readiness findings",
    input.finalReadinessFindings,
  );
  renderSections(writer, "Final risk findings", input.finalRiskFindings);
  renderSections(writer, "Checklist", input.checklist);
  renderSections(
    writer,
    "Provenance handles",
    input.provenanceHandles.map((handle) => ({
      title: "Reference",
      text: handle,
      provenanceHandles: [],
    })),
  );
  writer.finish();
  if (document.getPageCount() > MAX_PAGES)
    throw new ControlledPackageRendererError("RENDERER_PAGE_LIMIT_EXCEEDED");
  const bytes = await document.save({
    addDefaultPage: false,
    useObjectStreams: false,
    updateFieldAppearances: false,
  });
  if (bytes.byteLength > MAX_PDF_BYTES)
    throw new ControlledPackageRendererError(
      "RENDERER_PDF_SIZE_LIMIT_EXCEEDED",
    );
  return {
    bytes,
    pageCount: document.getPageCount(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function renderSections(
  writer: PdfWriter,
  heading: string,
  items: readonly ControlledPackageRenderItem[],
): void {
  writer.pageBreak();
  writer.heading(heading, 16);
  for (const item of [...items].sort(compareItems)) {
    writer.heading(item.title, 12);
    writer.lines([
      item.text,
      ...[...item.provenanceHandles]
        .sort()
        .map((handle) => `Provenance: ${handle}`),
    ]);
  }
}

function compareItems(
  left: ControlledPackageRenderItem,
  right: ControlledPackageRenderItem,
): number {
  return `${left.title}\u0000${left.text}` < `${right.title}\u0000${right.text}`
    ? -1
    : `${left.title}\u0000${left.text}` > `${right.title}\u0000${right.text}`
      ? 1
      : 0;
}

function validateInput(input: ControlledPackageRenderInput): void {
  if (
    input.rendererCompatibilityVersion !== CONTROLLED_PACKAGE_RENDERER_VERSION
  )
    throw new ControlledPackageRendererError("RENDERER_COMPATIBILITY_MISMATCH");
  const date = new Date(input.canonicalRenderTimestamp);
  const rowCount =
    input.checklist.length +
    input.finalReadinessFindings.length +
    input.finalRiskFindings.length;
  if (
    !Number.isFinite(date.valueOf()) ||
    input.draftSections.length === 0 ||
    input.draftSections.length > 40 ||
    input.provenanceHandles.length > 5_000 ||
    rowCount > 2_000
  )
    throw new ControlledPackageRendererError("RENDERER_INPUT_INVALID");
  const texts = [
    input.packageId,
    input.packageTitle,
    ...input.tenderIdentifiers,
    ...input.provenanceHandles,
    ...input.draftSections.flatMap(({ heading, text }) => [heading, text]),
    ...[
      ...input.warnings,
      ...input.checklist,
      ...input.finalReadinessFindings,
      ...input.finalRiskFindings,
    ].flatMap(({ provenanceHandles, text, title }) => [
      title,
      text,
      ...provenanceHandles,
    ]),
  ];
  if (texts.some((text) => text.length > MAX_FIELD || text.includes("\u0000")))
    throw new ControlledPackageRendererError("RENDERER_INPUT_INVALID");
}

class PdfWriter {
  private page!: PDFPage;
  private y = 0;
  constructor(
    private readonly document: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.pageBreak();
  }
  pageBreak(): void {
    if (this.document.getPageCount() >= MAX_PAGES)
      throw new ControlledPackageRendererError("RENDERER_PAGE_LIMIT_EXCEEDED");
    this.page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }
  heading(text: string, size: number): void {
    this.drawWrapped(text, this.bold, size, size + 6);
    this.y -= 5;
  }
  lines(values: readonly string[]): void {
    for (const value of values)
      this.drawWrapped(normalise(value), this.regular, FONT_SIZE, LINE_HEIGHT);
    this.y -= 4;
  }
  finish(): void {
    const total = this.document.getPageCount();
    this.document.getPages().forEach((page, index) =>
      page.drawText(
        `Controlled human review only  |  Page ${index + 1} of ${total}`,
        {
          x: MARGIN,
          y: 24,
          size: 8,
          font: this.regular,
          color: rgb(0.25, 0.25, 0.25),
        },
      ),
    );
  }
  private drawWrapped(
    value: string,
    font: PDFFont,
    size: number,
    lineHeight: number,
  ): void {
    try {
      font.encodeText(value);
    } catch {
      throw new ControlledPackageRendererError("RENDERER_UNSUPPORTED_TEXT");
    }
    const words = value.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= PAGE_WIDTH - MARGIN * 2)
        line = candidate;
      else {
        if (line) this.drawLine(line, font, size, lineHeight);
        line = word;
      }
    }
    this.drawLine(line, font, size, lineHeight);
  }
  private drawLine(
    text: string,
    font: PDFFont,
    size: number,
    lineHeight: number,
  ): void {
    if (this.y < MARGIN + 24) this.pageBreak();
    this.page.drawText(text, {
      x: MARGIN,
      y: this.y,
      size,
      font,
      color: rgb(0.08, 0.1, 0.13),
    });
    this.y -= lineHeight;
  }
}

function normalise(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC").replace(/\n/g, " ");
}
