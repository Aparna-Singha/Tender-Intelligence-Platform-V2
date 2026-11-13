import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { ragRetrievalQuery } from "../apps/worker/src/rag-processor.ts";

const target = process.env.RAG_RANKING_TEST_DATABASE_URL;
if (!target) throw new Error("DISPOSABLE_DATABASE_URL_REQUIRED");
const parsed = new URL(target);
if (
  parsed.protocol !== "postgresql:" ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "16484" ||
  parsed.pathname !== "/bidveda_rag_ranking_disposable" ||
  parsed.username !== "postgres" ||
  parsed.search !== ""
)
  throw new Error("DISPOSABLE_DATABASE_TARGET_REQUIRED");

const client = new pg.Client({
  connectionString: target,
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
});
function uuid(seed) {
  const hash = createHash("sha256")
    .update(`rag-ranking-fixture:${seed}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
const dimensions = 768;
const topicDimension = {
  documents: 0,
  eligibility: 1,
  risks: 2,
  summary: 3,
  exemptions: 4,
  missing: 5,
  policy: 6,
  company: 7,
};
function vector(topic, blend = 0) {
  const values = Array(dimensions).fill(0);
  values[topicDimension[topic]] = 1;
  if (blend !== 0) values[topicDimension.policy] = blend;
  return `[${values.join(",")}]`;
}
const ids = {
  organisation: uuid("organisation"),
  otherOrganisation: uuid("other-organisation"),
  tender: uuid("tender"),
  otherTender: uuid("other-tender"),
  version: uuid("version"),
  otherVersion: uuid("other-version"),
  index: uuid("index"),
  oldIndex: uuid("old-index"),
};
const scope = {
  organisationId: ids.organisation,
  tenderId: ids.tender,
  tenderVersionId: ids.version,
  indexRunId: ids.index,
  sourceMode: "TENDER_ONLY",
};
const rows = [];
function add(sourceClass, topic, content, overrides = {}) {
  rows.push({
    id: uuid(`${sourceClass}:${topic}:${content}:${JSON.stringify(overrides)}`),
    sourceClass,
    topic,
    content,
    scope: { ...scope, ...overrides },
    embedding: vector(
      topic,
      sourceClass === "STRUCTURED_REQUIREMENT"
        ? 0.24
        : sourceClass === "STRUCTURED_FIELD"
          ? 0.39
          : 0,
    ),
    validCitation:
      sourceClass === "TENDER_PRIMARY" ||
      sourceClass === "STRUCTURED_REQUIREMENT" ||
      sourceClass === "STRUCTURED_FIELD",
  });
}

const primary = {
  documents: [
    "Upload company registration certificate with bid",
    "Upload GST registration certificate with bid",
    "Upload audited financial statements with bid",
    "Upload performance guarantee with bid",
    "Upload signed compliance declaration with bid",
  ],
  eligibility: [
    "Minimum annual turnover is required",
    "Three years relevant experience is required",
    "Valid GST registration is required",
    "No blacklisting is permitted",
    "ISO quality certification is required",
  ],
  risks: [
    "Late submission causes disqualification",
    "Missing earnest money causes disqualification",
    "False declaration causes disqualification",
    "Noncompliant technical specification causes disqualification",
    "Expired registration causes disqualification",
  ],
};
for (const [topic, texts] of Object.entries(primary))
  for (const content of texts) add("TENDER_PRIMARY", topic, content);

const requirements = {
  documents: [
    "Company registration evidence must accompany the offer",
    "GST evidence must accompany the offer",
    "Audited statements must accompany the offer",
    "Signed declaration must accompany the offer",
  ],
  eligibility: [
    "Turnover threshold applies",
    "Experience threshold applies",
    "Valid tax registration applies",
    "ISO certificate applies",
  ],
  risks: [
    "Late offer shall be rejected",
    "Earnest money omission shall be rejected",
    "False declaration shall be rejected",
    "Technical noncompliance shall be rejected",
  ],
};
for (const [topic, texts] of Object.entries(requirements))
  for (const content of texts) add("STRUCTURED_REQUIREMENT", topic, content);
add(
  "STRUCTURED_REQUIREMENT",
  "exemptions",
  "Exemption requires supporting MSME certificate",
);
add("STRUCTURED_FIELD", "summary", "Tender number TEST-001");
add("STRUCTURED_FIELD", "summary", "Submission deadline 30 November");
add("STRUCTURED_FIELD", "summary", "Buyer Synthetic Agency");
add(
  "TENDER_METADATA",
  "summary",
  "Synthetic tender title, buyer and submission deadline",
);
add("SYSTEM_POLICY", "policy", "Only cited evidence may support an answer");
assert.equal(rows.length, 33);

const excluded = [];
function addExcluded(sourceClass, topic, content, override) {
  add(sourceClass, topic, content, override);
  excluded.push(rows.at(-1).id);
}
addExcluded("TENDER_PRIMARY", "documents", "Other organisation document", {
  organisationId: ids.otherOrganisation,
});
addExcluded("TENDER_PRIMARY", "documents", "Other tender document", {
  tenderId: ids.otherTender,
});
addExcluded("TENDER_PRIMARY", "documents", "Other version document", {
  tenderVersionId: ids.otherVersion,
});
addExcluded("TENDER_PRIMARY", "documents", "Older index document", {
  indexRunId: ids.oldIndex,
});
addExcluded("COMPANY_EVIDENCE", "company", "Approved company evidence", {});
const companyId = excluded.at(-1);
const byId = new Map(rows.map((row) => [row.id, row]));

async function insertRows() {
  const columns = [
    "id",
    "organisation_id",
    "tender_id",
    "tender_version_id",
    "index_run_id",
    "source_class",
    "content",
    "content_checksum",
    "document_name",
    "page_number",
    "clause_label",
    "embedding",
  ];
  const values = [];
  const tuples = rows.map((row, index) => {
    values.push(
      row.id,
      row.scope.organisationId,
      row.scope.tenderId,
      row.scope.tenderVersionId,
      row.scope.indexRunId,
      row.sourceClass,
      row.content,
      createHash("sha256").update(row.content).digest("hex"),
      "Synthetic Tender",
      index + 1,
      row.topic,
      row.embedding,
    );
    const offset = index * columns.length;
    return `(${columns.map((_, i) => `$${offset + i + 1}`).join(",")})`;
  });
  await client.query(
    `INSERT INTO rag_chunks (${columns.join(",")}) VALUES ${tuples.join(",")}`,
    values,
  );
}

function oldQuery(query) {
  const old = query.text
    .replace(
      "rank() OVER (ORDER BY lexical_score DESC) AS lexical_rank",
      'rank() OVER (ORDER BY lexical_score DESC, "id") AS lexical_rank',
    )
    .replace(
      "rank() OVER (ORDER BY vector_score DESC) AS vector_rank",
      'rank() OVER (ORDER BY vector_score DESC, "id") AS vector_rank',
    )
    .replace(
      /WHERE lexical_position <= (\$\d+)\s+OR vector_position <= (\$\d+)/,
      "WHERE lexical_rank <= $1 OR vector_rank <= $2 OR " +
        "\"source_class\"::text IN ('TENDER_METADATA','STRUCTURED_FIELD')",
    )
    .replace(
      'ORDER BY fused_score DESC, "id"',
      "ORDER BY CASE WHEN \"source_class\"::text = 'TENDER_METADATA' THEN 0 " +
        "WHEN \"source_class\"::text = 'STRUCTURED_FIELD' THEN 1 ELSE 2 END, " +
        'fused_score DESC, "id"',
    );
  assert.notEqual(old, query.text);
  return { text: old, values: query.values };
}

async function result(query) {
  return (await client.query(query.text, query.values)).rows;
}
async function medianExecutionMs(query) {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const explain = await client.query(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${query.text}`,
      query.values,
    );
    times.push(explain.rows[0]["QUERY PLAN"][0]["Execution Time"]);
  }
  times.sort((a, b) => a - b);
  return times[2];
}

let began = false;
let rolledBack = false;
let stage = "CONNECT";
try {
  await client.connect();
  stage = "SETUP";
  await client.query("BEGIN TRANSACTION");
  began = true;
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  await client.query(`
    CREATE TEMP TABLE rag_chunks (
      id uuid PRIMARY KEY, organisation_id uuid NOT NULL,
      tender_id uuid NOT NULL, tender_version_id uuid NOT NULL,
      index_run_id uuid NOT NULL, source_class text NOT NULL,
      content text NOT NULL, content_checksum char(64) NOT NULL,
      document_name text NOT NULL, page_number integer,
      clause_label text, search_vector tsvector
        GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      embedding vector(768) NOT NULL
    ) ON COMMIT DROP
  `);
  await insertRows();
  stage = "RETRIEVAL";
  const questions = [
    ["summary", "Summarize tender title buyer and deadline"],
    ["documents", "Which documents must be uploaded?"],
    ["eligibility", "Which eligibility conditions apply?"],
    ["risks", "What causes disqualification?"],
    ["exemptions", "What exemption applies?"],
    ["missing", "What is the aircraft licensing clause?"],
  ];
  for (const [topic, question] of questions) {
    const query = ragRetrievalQuery(scope, question, JSON.parse(vector(topic)));
    const before = await result(oldQuery(query));
    const after = await result(query);
    assert.equal(after.length, 8);
    assert.equal(new Set(after.map((row) => row.chunk_id)).size, 8);
    assert.ok(after.every((row) => !excluded.includes(row.chunk_id)));
    assert.deepEqual(
      after.map((row) => row.chunk_id),
      (await result(query)).map((row) => row.chunk_id),
    );
    const beforeRelevant = before.filter(
      (row) => byId.get(row.chunk_id)?.topic === topic,
    ).length;
    const afterRelevant = after.filter(
      (row) => byId.get(row.chunk_id)?.topic === topic,
    ).length;
    if (["documents", "eligibility", "risks"].includes(topic)) {
      assert.ok(afterRelevant > beforeRelevant);
      assert.equal(afterRelevant, 8);
      assert.ok(after.every((row) => byId.get(row.chunk_id)?.validCitation));
    }
    if (topic === "summary") {
      assert.ok(afterRelevant >= beforeRelevant);
      assert.ok(
        after.some(
          (row) => byId.get(row.chunk_id)?.sourceClass === "TENDER_METADATA",
        ),
      );
    }
    if (topic === "exemptions") assert.ok(afterRelevant >= 1);
    if (topic === "missing") assert.equal(afterRelevant, 0);
    console.log(`PASS ${topic} recall8 ${beforeRelevant}->${afterRelevant}`);
  }
  const companyQuery = ragRetrievalQuery(
    { ...scope, sourceMode: "FULL_AUTHORISED_TENDER_CONTEXT" },
    "Approved company evidence",
    JSON.parse(vector("company")),
  );
  assert.ok(
    (await result(companyQuery)).some((row) => row.chunk_id === companyId),
  );
  const tenderOnlyCompanyQuery = ragRetrievalQuery(
    scope,
    "Approved company evidence",
    JSON.parse(vector("company")),
  );
  assert.ok(
    (await result(tenderOnlyCompanyQuery)).every(
      (row) => row.chunk_id !== companyId,
    ),
  );
  for (const [scopedId, value, expectedId] of [
    ["organisationId", ids.otherOrganisation, excluded[0]],
    ["tenderId", ids.otherTender, excluded[1]],
    ["tenderVersionId", ids.otherVersion, excluded[2]],
    ["indexRunId", ids.oldIndex, excluded[3]],
  ]) {
    const scopedQuery = ragRetrievalQuery(
      { ...scope, [scopedId]: value },
      "Which documents must be uploaded?",
      JSON.parse(vector("documents")),
    );
    assert.deepEqual(
      (await result(scopedQuery)).map((row) => row.chunk_id),
      [expectedId],
    );
  }
  assert.equal(
    (
      await result(
        ragRetrievalQuery(
          { ...scope, organisationId: uuid("absent-organisation") },
          "Which documents must be uploaded?",
          JSON.parse(vector("documents")),
        ),
      )
    ).length,
    0,
  );
  const staleQuery = ragRetrievalQuery(
    { ...scope, indexRunId: ids.oldIndex },
    "Which documents must be uploaded?",
    JSON.parse(vector("documents")),
  );
  assert.ok(
    (await result(staleQuery)).every((row) => row.chunk_id === excluded[3]),
  );
  console.log(
    "PASS scope isolation, source modes, stale index scope, deterministic ties",
  );
  const perfQuestion = "Which documents must be uploaded?";
  const perf = ragRetrievalQuery(
    scope,
    perfQuestion,
    JSON.parse(vector("documents")),
  );
  const beforeMs = await medianExecutionMs(oldQuery(perf));
  stage = "LATENCY";
  const afterMs = await medianExecutionMs(perf);
  console.log(
    `PASS local query latency median5 baseline=${beforeMs.toFixed(3)}ms corrected=${afterMs.toFixed(3)}ms`,
  );
} catch (error) {
  const code =
    typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)
      ? error.code
      : "UNCLASSIFIED";
  console.error(
    `FAIL disposable retrieval integration stage=${stage} category=${error?.name ?? "UNKNOWN"} code=${code}`,
  );
  process.exitCode = 1;
} finally {
  if (began) {
    try {
      await client.query("ROLLBACK");
      rolledBack = true;
      console.log("PASS disposable transaction rolled back");
    } catch {
      console.error("FAIL disposable transaction rollback");
      process.exitCode = 1;
    }
  }
  await client.end().catch(() => {
    process.exitCode = 1;
  });
  if (rolledBack) {
    const verify = new pg.Client({
      connectionString: target,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
    });
    try {
      await verify.connect();
      const check = await verify.query(
        "SELECT to_regclass('public.rag_chunks') AS committed_table",
      );
      assert.equal(check.rows[0].committed_table, null);
      console.log("PASS independent post-rollback verification");
    } catch {
      console.error("FAIL independent post-rollback verification");
      process.exitCode = 1;
    } finally {
      await verify.end().catch(() => {
        process.exitCode = 1;
      });
    }
  }
}
