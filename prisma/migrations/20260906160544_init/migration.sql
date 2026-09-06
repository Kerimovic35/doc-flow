-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('ANTHROPIC', 'OLLAMA');

-- CreateEnum
CREATE TYPE "PersonKind" AS ENUM ('SELF', 'FAMILY', 'OTHER');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('UPLOADED', 'PREPARING', 'OCR', 'ANALYZING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('NONE', 'NEEDED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "DocumentLifecycle" AS ENUM ('ACTIVE', 'ARCHIVED', 'DONE');

-- CreateEnum
CREATE TYPE "TextSource" AS ENUM ('NONE', 'PDF_TEXT', 'OCR', 'VISION');

-- CreateEnum
CREATE TYPE "RunKind" AS ENUM ('INGEST', 'OCR', 'ANALYSIS');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('INGEST', 'OCR', 'ANALYZE', 'DAILY_MAINTENANCE', 'BACKUP');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Verification" AS ENUM ('VERIFIED', 'QUOTE_ONLY', 'UNVERIFIED', 'USER');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('TASK', 'DEADLINE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PROPOSED', 'OPEN', 'DONE', 'POSTPONED', 'IGNORED');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('OUTGOING', 'INCOMING');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PROPOSED', 'OPEN', 'PAID', 'IGNORED');

-- CreateEnum
CREATE TYPE "ConversationScope" AS ENUM ('GLOBAL', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_provider" "AiProviderKind" NOT NULL DEFAULT 'ANTHROPIC',
    "ai_model" TEXT NOT NULL DEFAULT 'claude-opus-5',
    "ai_effort" TEXT NOT NULL DEFAULT 'high',
    "analysis_use_images" BOOLEAN NOT NULL DEFAULT true,
    "vision_ocr_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ocr_threshold" INTEGER NOT NULL DEFAULT 70,
    "auto_analyze" BOOLEAN NOT NULL DEFAULT true,
    "reminder_days" JSONB NOT NULL DEFAULT '[7, 3, 1, 0]',
    "default_category_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "system_state" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PersonKind" NOT NULL DEFAULT 'FAMILY',
    "birth_date" DATE,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tags" (
    "document_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("document_id","tag_id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
    "processing_step" TEXT,
    "progress_done" INTEGER NOT NULL DEFAULT 0,
    "progress_total" INTEGER NOT NULL DEFAULT 0,
    "failed_step" "JobType",
    "last_error" TEXT,
    "review_state" "ReviewState" NOT NULL DEFAULT 'NONE',
    "lifecycle" "DocumentLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" TIMESTAMP(3),
    "title" TEXT,
    "document_type" TEXT,
    "sender" TEXT,
    "recipient" TEXT,
    "subject" TEXT,
    "summary" TEXT,
    "document_date" DATE,
    "received_date" DATE,
    "person_id" TEXT,
    "person_uncertain" BOOLEAN NOT NULL DEFAULT false,
    "category_id" TEXT,
    "field_meta" JSONB NOT NULL DEFAULT '{}',
    "search_vector" tsvector,
    "ocr_at" TIMESTAMP(3),
    "analyzed_at" TIMESTAMP(3),
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_files" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_pages" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "page_in_file" INTEGER NOT NULL DEFAULT 1,
    "width" INTEGER,
    "height" INTEGER,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "image_key" TEXT,
    "thumb_key" TEXT,
    "ocr_input_key" TEXT,
    "text" TEXT,
    "text_source" "TextSource" NOT NULL DEFAULT 'NONE',
    "ocr_confidence" INTEGER,
    "ocr_run_id" TEXT,
    "search_vector" tsvector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_identifiers" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "page" INTEGER,
    "quote" TEXT,
    "verification" "Verification" NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "RunKind" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT,
    "model" TEXT,
    "input_hash" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_cents" INTEGER,
    "raw_output" JSONB,
    "error" TEXT,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "document_id" TEXT,
    "user_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT NOT NULL DEFAULT '',
    "run_after" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "locked_by" TEXT,
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT,
    "kind" "TaskKind" NOT NULL DEFAULT 'TASK',
    "status" "TaskStatus" NOT NULL DEFAULT 'PROPOSED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "due_uncertain" BOOLEAN NOT NULL DEFAULT false,
    "due_rule" TEXT,
    "page" INTEGER,
    "quote" TEXT,
    "verification" "Verification" NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "analysis_run_id" TEXT,
    "dedupe_key" TEXT,
    "postponed_to" DATE,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PROPOSED',
    "direction" "PaymentDirection" NOT NULL DEFAULT 'OUTGOING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "due_date" DATE,
    "due_uncertain" BOOLEAN NOT NULL DEFAULT false,
    "due_rule" TEXT,
    "purpose" TEXT,
    "iban" TEXT,
    "recipient" TEXT,
    "page" INTEGER,
    "quote" TEXT,
    "verification" "Verification" NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "analysis_run_id" TEXT,
    "dedupe_key" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT,
    "payment_id" TEXT,
    "days_before" INTEGER NOT NULL,
    "remind_at" TIMESTAMP(3) NOT NULL,
    "seen_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" "ConversationScope" NOT NULL DEFAULT 'GLOBAL',
    "document_id" TEXT,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "structured" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_sources" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "page_id" TEXT,
    "page" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "verification" "Verification" NOT NULL DEFAULT 'VERIFIED',
    "claim_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "persons_user_id_idx" ON "persons"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "persons_user_id_name_key" ON "persons"("user_id", "name");

-- CreateIndex
CREATE INDEX "categories_user_id_idx" ON "categories"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_user_id_slug_key" ON "categories"("user_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_user_id_name_key" ON "tags"("user_id", "name");

-- CreateIndex
CREATE INDEX "document_tags_tag_id_idx" ON "document_tags"("tag_id");

-- CreateIndex
CREATE INDEX "documents_user_id_deleted_at_lifecycle_created_at_idx" ON "documents"("user_id", "deleted_at", "lifecycle", "created_at" DESC);

-- CreateIndex
CREATE INDEX "documents_user_id_processing_status_idx" ON "documents"("user_id", "processing_status");

-- CreateIndex
CREATE INDEX "documents_user_id_person_id_idx" ON "documents"("user_id", "person_id");

-- CreateIndex
CREATE INDEX "documents_user_id_category_id_idx" ON "documents"("user_id", "category_id");

-- CreateIndex
CREATE INDEX "documents_user_id_document_date_idx" ON "documents"("user_id", "document_date");

-- CreateIndex
CREATE UNIQUE INDEX "document_files_storage_key_key" ON "document_files"("storage_key");

-- CreateIndex
CREATE INDEX "document_files_document_id_idx" ON "document_files"("document_id");

-- CreateIndex
CREATE INDEX "document_files_user_id_sha256_idx" ON "document_files"("user_id", "sha256");

-- CreateIndex
CREATE INDEX "document_pages_user_id_idx" ON "document_pages"("user_id");

-- CreateIndex
CREATE INDEX "document_pages_file_id_idx" ON "document_pages"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_document_id_page_number_key" ON "document_pages"("document_id", "page_number");

-- CreateIndex
CREATE INDEX "document_identifiers_user_id_normalized_idx" ON "document_identifiers"("user_id", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "document_identifiers_document_id_kind_normalized_key" ON "document_identifiers"("document_id", "kind", "normalized");

-- CreateIndex
CREATE INDEX "analysis_runs_document_id_kind_started_at_idx" ON "analysis_runs"("document_id", "kind", "started_at" DESC);

-- CreateIndex
CREATE INDEX "analysis_runs_user_id_idx" ON "analysis_runs"("user_id");

-- CreateIndex
CREATE INDEX "processing_jobs_status_run_after_idx" ON "processing_jobs"("status", "run_after");

-- CreateIndex
CREATE UNIQUE INDEX "processing_jobs_document_id_type_dedupe_key_key" ON "processing_jobs"("document_id", "type", "dedupe_key");

-- CreateIndex
CREATE INDEX "tasks_user_id_status_due_date_idx" ON "tasks"("user_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_document_id_idx" ON "tasks"("document_id");

-- CreateIndex
CREATE INDEX "payments_user_id_status_due_date_idx" ON "payments"("user_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "payments_document_id_idx" ON "payments"("document_id");

-- CreateIndex
CREATE INDEX "reminders_user_id_remind_at_idx" ON "reminders"("user_id", "remind_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminders_task_id_days_before_key" ON "reminders"("task_id", "days_before");

-- CreateIndex
CREATE UNIQUE INDEX "reminders_payment_id_days_before_key" ON "reminders"("payment_id", "days_before");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_updated_at_idx" ON "ai_conversations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ai_conversations_document_id_idx" ON "ai_conversations"("document_id");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_sources_message_id_idx" ON "ai_sources"("message_id");

-- CreateIndex
CREATE INDEX "ai_sources_document_id_idx" ON "ai_sources"("document_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_default_category_id_fkey" FOREIGN KEY ("default_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_identifiers" ADD CONSTRAINT "document_identifiers_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_identifiers" ADD CONSTRAINT "document_identifiers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "document_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Volltextsuche
-- ============================================================
-- Prisma kennt keine erzeugten Spalten. Die von Prisma angelegten
-- tsvector-Spalten werden deshalb hier durch GENERATED-Spalten ersetzt: Der
-- Index bleibt damit ohne Trigger und ohne Zutun der Anwendung stets aktuell.
-- Im Schema stehen sie als Unsupported("tsvector") - sonst wuerde die
-- naechste Migration sie als Abweichung wieder entfernen.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "documents" DROP COLUMN "search_vector";
ALTER TABLE "documents" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('german', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('german', coalesce("sender", '') || ' ' || coalesce("subject", '')), 'B') ||
    setweight(to_tsvector('german',
      coalesce("summary", '') || ' ' ||
      coalesce("document_type", '') || ' ' ||
      coalesce("recipient", '')), 'C')
  ) STORED;

CREATE INDEX "documents_search_vector_idx" ON "documents" USING GIN ("search_vector");

ALTER TABLE "document_pages" DROP COLUMN "search_vector";
ALTER TABLE "document_pages" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('german', coalesce("text", ''))) STORED;

CREATE INDEX "document_pages_search_vector_idx" ON "document_pages" USING GIN ("search_vector");

-- Trigramme fangen ab, woran die Wortsuche scheitert: Tippfehler und
-- Erkennungsfehler ("Versicherun9"). Bewusst nur auf kurzen Feldern - ueber
-- dem gesamten Seitentext waere der Index um ein Vielfaches groesser als die
-- Daten selbst.
CREATE INDEX "documents_title_trgm_idx" ON "documents" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "documents_sender_trgm_idx" ON "documents" USING GIN ("sender" gin_trgm_ops);
CREATE INDEX "document_identifiers_normalized_trgm_idx"
  ON "document_identifiers" USING GIN ("normalized" gin_trgm_ops);
