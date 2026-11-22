/**
 * The schema of `sud.db`, as numbered migrations (`PRAGMA user_version`). Append a new `{ v, sql }`; never edit a released one.
 *
 *  bills        every court bill of a company, compact (`core/bill-rows`); `ctype` / `kind` / `yymm` / `hay` are derived at insert so the tab's
 *               filters and the by-number job are plain index lookups; `pass` = the last billing pass that returned the bill
 *  bill_loads   how far the load of a company's bills got (`lib/bill-cases`)
 *  found_cases  cases found BY NUMBER from the bills (no TIN list shows them): the list row as JSON, per court type
 *  tried        case numbers already asked of the court (found or not)
 *  case_details a case's full detail (gzip JSON), per court type and number
 *  meta         key/value: the legacy import marker …
 * Court type is the FIRST column of the case tables' keys, so each court's rows sit together.
 */

export const MIGRATIONS: ReadonlyArray<{ v: number; sql: string }> = [
  {
    v: 1,
    sql: `
CREATE TABLE bills (
  tin TEXT NOT NULL, number TEXT NOT NULL, pass INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '', issued INTEGER, amount INTEGER, paid INTEGER, must_pay INTEGER, balance INTEGER, overdue INTEGER,
  cat TEXT NOT NULL DEFAULT '', cat_id INTEGER, court TEXT NOT NULL DEFAULT '', court_id INTEGER, court_type TEXT NOT NULL DEFAULT '',
  case_number TEXT, decision INTEGER, descr TEXT NOT NULL DEFAULT '', payer TEXT NOT NULL DEFAULT '', payer_tin TEXT NOT NULL DEFAULT '',
  in_favor INTEGER, account TEXT NOT NULL DEFAULT '',
  ctype TEXT, kind TEXT NOT NULL DEFAULT 'other', yymm INTEGER NOT NULL DEFAULT -1, hay TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tin, number)
) WITHOUT ROWID;
CREATE INDEX bills_issued ON bills (tin, issued DESC, number);
CREATE INDEX bills_ctype ON bills (tin, ctype, issued DESC, number);
CREATE INDEX bills_case ON bills (tin, case_number) WHERE case_number IS NOT NULL;

CREATE TABLE bill_loads (
  tin TEXT PRIMARY KEY, total_elements INTEGER NOT NULL DEFAULT 0, total_pages INTEGER NOT NULL DEFAULT 0, page_size INTEGER NOT NULL DEFAULT 0,
  pass INTEGER NOT NULL DEFAULT 0, pages_done INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0, stable INTEGER NOT NULL DEFAULT 0,
  loaded_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE found_cases (
  court TEXT NOT NULL, tin TEXT NOT NULL, num TEXT NOT NULL, yymm INTEGER NOT NULL DEFAULT -1, status TEXT NOT NULL DEFAULT '',
  hay TEXT NOT NULL DEFAULT '', row TEXT NOT NULL, t INTEGER NOT NULL,
  PRIMARY KEY (court, tin, num)
) WITHOUT ROWID;
CREATE INDEX found_by_tin ON found_cases (tin, court, yymm DESC, num);

CREATE TABLE tried (tin TEXT NOT NULL, num TEXT NOT NULL, t INTEGER NOT NULL, found INTEGER NOT NULL, PRIMARY KEY (tin, num)) WITHOUT ROWID;

CREATE TABLE case_details (court TEXT NOT NULL, num TEXT NOT NULL, t INTEGER NOT NULL, d BLOB NOT NULL, PRIMARY KEY (court, num)) WITHOUT ROWID;

CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`,
  },
  {
    // when a company's data was first scraped and last brought up to date (lib/company-meta): refreshes start from these dates
    v: 2,
    sql: `
CREATE TABLE companies (
  tin TEXT PRIMARY KEY,
  first_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL DEFAULT 0,
  last_added INTEGER NOT NULL DEFAULT 0
);
`,
  },
  {
    // a case's registration month (yymm of «2-1004-2603/8020», -1 when unreadable) computed by the database itself, so the backup can cut case
    // details into year buckets with an index instead of reading every row (same rule as core/bill-cases registeredKey)
    v: 3,
    sql: `
ALTER TABLE case_details ADD COLUMN yymm INTEGER GENERATED ALWAYS AS (
  CASE WHEN substr(num, instr(num, '-') + instr(substr(num, instr(num, '-') + 1), '-') + 5, 1) = '/'
       THEN CAST(substr(num, instr(num, '-') + instr(substr(num, instr(num, '-') + 1), '-') + 1, 4) AS INTEGER)
       ELSE -1 END
) VIRTUAL;
CREATE INDEX details_by_year ON case_details (court, yymm);
`,
  },
]
