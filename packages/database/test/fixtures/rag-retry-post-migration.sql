-- Run after audit-fixture.sql and migration.sql in a disposable PostgreSQL 17 database.
BEGIN;
INSERT INTO rag_answer_runs (id,organisation_id,tender_id,tender_version_id,conversation_id,question_message_id,answer_message_id,retry_of_run_id,index_run_id,source_mode,status,retrieval_policy_version,answer_policy_version,provider,model,idempotency_key) VALUES
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000006','TENDER_ONLY','COMPLETE','r1','a1','synthetic','synthetic','audit-retry-1'),
 ('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000006','TENDER_ONLY','COMPLETE','r1','a1','synthetic','synthetic','audit-retry-2');
INSERT INTO rag_answer_citations (answer_run_id,chunk_id,handle,claim_text,excerpt,document_name,source_checksum) VALUES
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000010','C1','Retry one','Source clause','Synthetic tender',repeat('b',64)),
 ('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000010','C1','Retry two','Source clause','Synthetic tender',repeat('b',64));
DO $$
DECLARE run_count integer; citation_count integer;
BEGIN
  SELECT count(*) INTO run_count FROM rag_answer_runs WHERE question_message_id='00000000-0000-0000-0000-000000000008';
  SELECT count(*) INTO citation_count FROM rag_answer_citations WHERE answer_run_id IN ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000015');
  IF run_count <> 3 OR citation_count <> 3 THEN RAISE EXCEPTION 'Lost history: runs %, citations %',run_count,citation_count; END IF;
  IF NOT EXISTS (SELECT 1 FROM rag_answer_runs WHERE id='00000000-0000-0000-0000-000000000011' AND answer_message_id='00000000-0000-0000-0000-000000000009' AND retry_of_run_id IS NULL) THEN RAISE EXCEPTION 'Original answer changed'; END IF;
  BEGIN
    INSERT INTO rag_answer_runs (organisation_id,tender_id,tender_version_id,conversation_id,question_message_id,retry_of_run_id,index_run_id,source_mode,retrieval_policy_version,answer_policy_version,provider,model,idempotency_key) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000006','TENDER_ONLY','r1','a1','synthetic','synthetic','audit-duplicate-child');
    RAISE EXCEPTION 'Duplicate child was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO rag_answer_runs (organisation_id,tender_id,tender_version_id,conversation_id,question_message_id,retry_of_run_id,index_run_id,source_mode,retrieval_policy_version,answer_policy_version,provider,model,idempotency_key) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000006','TENDER_ONLY','r1','a1','synthetic','synthetic','audit-bad-parent');
    RAISE EXCEPTION 'Missing parent was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
COMMIT;
SELECT 'PASS: original + two retries, three citations, unique parent and foreign key enforced' AS result;
