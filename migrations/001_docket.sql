-- 001_docket.sql — docket index for name-based case discovery (guide §5.1)
-- Apply once:  psql "$DATABASE_URL" -f migrations/001_docket.sql
--
-- Requires the pg_trgm extension for fuzzy name matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- One row per (case_number, court_type). Minimal, discovery-only:
-- store the minimum to DISCOVER a case (number + court type + party names);
-- full detail is fetched on demand by case number via getCaseDetails.
CREATE TABLE IF NOT EXISTS case_docket (
  case_number    text NOT NULL,
  court_type     text NOT NULL,               -- 'economic' | 'civil' | 'administrative'
  case_id        uuid,
  court_id       text,
  court_name     text,
  plaintiff      text,
  plaintiff_norm text,                          -- normalized (see src/lib/name-match.ts)
  plaintiff_tin  text,
  defendant      text,
  defendant_norm text,
  defendant_tin  text,
  hearing_date   date,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_number, court_type)
);

-- Trigram indexes power fuzzy name matching on both party sides.
CREATE INDEX IF NOT EXISTS idx_docket_plaintiff_trgm ON case_docket USING gin (plaintiff_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_docket_defendant_trgm ON case_docket USING gin (defendant_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_docket_ptin ON case_docket (plaintiff_tin) WHERE plaintiff_tin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docket_dtin ON case_docket (defendant_tin) WHERE defendant_tin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docket_hearing ON case_docket (hearing_date);

-- Crawl bookkeeping: one row per (court_id, court_type, docket_date) with its ETag.
CREATE TABLE IF NOT EXISTS crawl_state (
  court_id     text NOT NULL,
  court_type   text NOT NULL,
  docket_date  date NOT NULL,
  etag         text,
  row_count    int  NOT NULL DEFAULT 0,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (court_id, court_type, docket_date)
);

-- Retention (run daily via pruneOldDockets(); kept here for manual ops):
--   DELETE FROM case_docket WHERE hearing_date < (current_date - INTERVAL '90 days');
--   DELETE FROM crawl_state WHERE docket_date < (current_date - INTERVAL '90 days');
--
-- NOTE (verified live 2026-09): the vka endpoint rejects PAST dates with 400
-- ("Нотўғри сана белгиланган") — only today/future dockets are servable. The
-- 90-day archive therefore ACCUMULATES from daily future-crawls: rows are
-- captured while their hearings are upcoming and retained for 90 days after
-- they pass. There is no historical backfill path via vka.
