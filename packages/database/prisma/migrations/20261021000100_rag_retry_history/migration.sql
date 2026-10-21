ALTER TABLE "rag_answer_runs" DROP CONSTRAINT IF EXISTS "rag_answer_runs_question_message_id_key";
ALTER TABLE "rag_answer_runs" ADD COLUMN "retry_of_run_id" UUID;
CREATE INDEX "rag_answer_runs_question_message_id_created_at_idx" ON "rag_answer_runs"("question_message_id", "created_at");
CREATE UNIQUE INDEX "rag_answer_runs_retry_of_run_id_key" ON "rag_answer_runs"("retry_of_run_id");
ALTER TABLE "rag_answer_runs" ADD CONSTRAINT "rag_answer_runs_retry_of_run_id_fkey" FOREIGN KEY ("retry_of_run_id") REFERENCES "rag_answer_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
