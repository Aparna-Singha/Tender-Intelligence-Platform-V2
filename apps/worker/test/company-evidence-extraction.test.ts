import { describe, expect, it } from "vitest";
import type { ParsedDocument } from "@tender/domain";
import {
  addressesMateriallyDiffer,
  extractCompanyEvidenceFacts,
  normalizeAddress,
} from "../src/company-evidence-extraction.js";

function parsed(text: string, ocrStatus = "NOT_REQUIRED"): ParsedDocument {
  return {
    format: "PDF",
    issues: [],
    parserName: "test",
    parserVersion: "1",
    units: [
      {
        blocks: [
          {
            confidence: "HIGH",
            readingOrder: 0,
            sourceEndOffset: text.length,
            sourceStartOffset: 0,
            text,
            type: "PARAGRAPH",
            warnings: [],
          },
        ],
        characterCount: text.length,
        confidence: "HIGH",
        label: "Page 1",
        ocrStatus: ocrStatus as "NOT_REQUIRED",
        unitIndex: 1,
        unitType: "PAGE",
      },
    ],
  };
}

describe("company evidence extraction", () => {
  it("extracts a cited GST registration fact without accepting it", () => {
    const facts = extractCompanyEvidenceFacts(
      parsed(
        "GST Registration Certificate\nLegal name\nVertex Electromech Solutions Private Limited\nGSTIN\n29AAACV1234Q1ZK\nPAN\nAAACV1234Q\nPrincipal place of business\n44, Industrial Layout, Peenya Phase 2, Bengaluru, Karnataka 560058\nStatus\nActive\nEffective date\n12 April 2021",
      ),
    );
    expect(facts).toEqual([
      expect.objectContaining({
        factType: "GST_REGISTRATION",
        pageNumber: 1,
        textValue: "29AAACV1234Q1ZK",
        valueType: "TEXT",
      }),
    ]);
    expect(facts[0]?.scope).toContain("Vertex Electromech Solutions");
    expect(facts[0]?.scope).toContain("Bengaluru");
  });

  it("extracts turnover average as structured INR evidence", () => {
    const facts = extractCompanyEvidenceFacts(
      parsed(
        "CA-Certified Turnover Statement\nCompany\nVertex Electromech Solutions Private Limited\nCertificate date\n05 September 2026\nPurpose\nBid qualification\nFinancial year Turnover\n2023-24 INR 75,00,000\n2024-25 INR 82,00,000\n2025-26 INR 88,00,000\n3-year average INR 81,66,667",
      ),
    );
    expect(facts[0]).toEqual(
      expect.objectContaining({
        currency: "INR",
        factType: "TURNOVER_3_YEAR_AVERAGE",
        numberValue: 8_166_667,
        valueType: "NUMBER",
      }),
    );
  });

  it("retains ISO validity and scope", () => {
    const facts = extractCompanyEvidenceFacts(
      parsed(
        "ISO 9001:2015 Certificate\nCertificate holder\nVertex Electromech Solutions Private Limited\nCertificate no.\nISO-4418\nStandard\nISO 9001:2015\nScope\nSupply and servicing of motor protection equipment\nIssue date\n01 January 2025\nValid until\n31 December 2027\nStatus\nValid",
      ),
    );
    expect(facts[0]).toEqual(
      expect.objectContaining({
        factType: "ISO_9001_CERTIFICATION",
        textValue: "ISO 9001:2015",
        validUntil: new Date("2027-12-31T00:00:00.000Z"),
      }),
    );
    expect(facts[0]?.scope).toContain("motor protection equipment");
  });

  it("reads exact line labels without treating document headings as values", () => {
    const purchaseOrder = extractCompanyEvidenceFacts(
      parsed(
        "Past Purchase Order — Similar Supply\nPO\nMWC/PO/2025-26/1187\nCustomer\nMetro Water Controls Ltd.\nSupplier\nVertex Electromech Solutions Private Limited\nPO date\n12 August 2025\nOrder value\nINR 28,40,000 excluding GST\nScope\nMotor protection relays and contactor accessories",
      ),
    )[0];
    const authorisation = extractCompanyEvidenceFacts(
      parsed(
        "OEM Authorisation Letter — Tender-Specific\nOEM\nOrion Controls India Private Limited\nAuthorised bidder\nVertex Electromech Solutions Private Limited\nTender\nTEST/GEM/2026/B/900001\nProduct family\nOR-MPR smart motor protection relays\nAuthorisation date\n22 September 2026\nValid through\n31 December 2026",
      ),
    )[0];
    expect(purchaseOrder).toEqual(
      expect.objectContaining({
        factType: "PURCHASE_ORDER_VALUE",
        numberValue: 2_840_000,
      }),
    );
    expect(purchaseOrder?.scope).toContain("PO number: MWC/PO/2025-26/1187");
    expect(authorisation).toEqual(
      expect.objectContaining({
        factType: "OEM_AUTHORISATION",
        textValue: "Orion Controls India Private Limited",
      }),
    );
  });

  it("normalises harmless formatting but flags materially different addresses", () => {
    expect(normalizeAddress("44 Industrial Layout, Peenya Phase 2")).toBe(
      normalizeAddress("44, Industrial Layout, Peenya Phase-II"),
    );
    expect(
      addressesMateriallyDiffer(
        "44 Industrial Layout, Peenya Phase 2, Bengaluru, Karnataka 560058",
        "44, Industrial Layout, Peenya Phase-II, Bengaluru, Karnataka 560058",
      ),
    ).toBe(false);
    expect(
      addressesMateriallyDiffer(
        "44 Industrial Layout, Bengaluru, Karnataka 560058",
        "77 Old Market Road, Mysuru, Karnataka 570001",
      ),
    ).toBe(true);
  });
});
