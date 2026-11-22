//! The questions the bot answers, over the locator in memory and the buckets fetched on demand. Pure of HTTP and chat: `http/` and `chat.rs` only
//! call these and format the result.

use crate::domain::{Bill, BillPage, CaseRef, CasePage, CaseView, Company, CompanyHit, Overview, YearCount};
use crate::error::{AppError, AppResult};
use crate::index::is_case_like;
use crate::state::Shared;
use serde_json::Value;
use std::{collections::BTreeMap, io::Read};

/// one bucket's lines, as JSON arrays
fn rows(text: &[u8]) -> Vec<Vec<Value>> {
    String::from_utf8_lossy(text).lines().filter(|l| !l.is_empty()).filter_map(|l| serde_json::from_str::<Vec<Value>>(l).ok()).collect()
}

fn str_at(r: &[Value], i: usize) -> &str {
    r.get(i).and_then(|v| v.as_str()).unwrap_or("")
}

fn gunzip(b: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(b).read_to_end(&mut out).ok()?;
    Some(out)
}

/// a bill row (the app's column order) as an object
pub fn bill_of(r: &[Value]) -> Bill {
    let g = |i: usize| r.get(i).cloned().unwrap_or(Value::Null);
    Bill { tin: g(0), number: g(1), status: g(2), issued: g(3), amount: g(4), paid: g(5), must_pay: g(6), balance: g(7), overdue: g(8), cat: g(9), court: g(11), court_type: g(13), case_number: g(14), payer: g(17), payer_tin: g(18) }
}

impl Shared {
    fn upstream(e: String) -> AppError {
        AppError::Upstream(e)
    }

    /// every company the backup holds, known by its dates (manifest) or by its index bucket
    async fn tins(&self) -> Vec<String> {
        let s = self.st.read().await;
        let mut set: std::collections::BTreeSet<String> = s.index.tins().into_iter().collect();
        if let Some(m) = &s.manifest {
            set.extend(m.companies.keys().cloned());
        }
        set.into_iter().collect()
    }

    pub async fn company(&self, tin: &str) -> Option<Company> {
        let s = self.st.read().await;
        let m = s.manifest.as_ref()?;
        let (mut bills, mut found, mut listed, mut years) = (0usize, 0usize, 0usize, Vec::new());
        let mut known = false;
        for b in &m.buckets {
            let p: Vec<&str> = b.name.split(':').collect();
            if p.get(1) != Some(&tin) {
                continue;
            }
            known = true;
            match p[0] {
                "bills" => {
                    bills += b.rows;
                    if let Some(y) = p.get(2) {
                        years.push(y.to_string());
                    }
                }
                "found" => found += b.rows,
                "lists" => listed += b.rows,
                _ => {}
            }
        }
        if !known && !m.companies.contains_key(tin) {
            return None;
        }
        years.sort();
        years.dedup();
        let d = m.companies.get(tin);
        Some(Company { tin: tin.to_string(), bills, found, listed, years, first_at: d.map(|d| d.first_at).unwrap_or(0), refreshed_at: d.map(|d| d.refreshed_at).unwrap_or(0) })
    }

    pub async fn companies(&self) -> Vec<Company> {
        let mut out = Vec::new();
        for t in self.tins().await {
            if let Some(c) = self.company(&t).await {
                out.push(c);
            }
        }
        out.sort_by(|a, b| (b.bills + b.found + b.listed).cmp(&(a.bills + a.found + a.listed)));
        out
    }

    /// The dashboard of a company: its numbers, its cases per court type and per registration year, and its bills per year.
    pub async fn overview(&self, tin: &str) -> AppResult<Overview> {
        let company = self.company(tin).await.ok_or_else(|| AppError::NotFound("Bunday kompaniya zaxirada yoʻq".into()))?;
        let cases = { self.st.read().await.index.shard_cases(tin) };
        let mut courts: BTreeMap<String, usize> = BTreeMap::new();
        let mut per_year: BTreeMap<u32, (usize, usize)> = BTreeMap::new();
        for (_, court, yy) in &cases {
            *courts.entry(court.clone()).or_default() += 1;
            per_year.entry(2000 + yy).or_default().0 += 1;
        }
        {
            let s = self.st.read().await;
            if let Some(m) = &s.manifest {
                for b in &m.buckets {
                    let p: Vec<&str> = b.name.split(':').collect();
                    if p.first() == Some(&"bills") && p.get(1) == Some(&tin) {
                        if let Some(y) = p.get(2).and_then(|y| y.parse::<u32>().ok()) {
                            per_year.entry(y).or_default().1 += b.rows;
                        }
                    }
                }
            }
        }
        let by_year = per_year.into_iter().filter(|(y, _)| *y >= 2000).map(|(year, (cases, bills))| YearCount { year, cases, bills }).collect();
        Ok(Overview { company, cases: cases.len(), courts, by_year })
    }

    /// the search box: a STIR (company), a bill number or a case number, by prefix
    pub async fn search(&self, raw: &str, limit: usize) -> Vec<Value> {
        let q = raw.trim();
        let mut out: Vec<Value> = Vec::new();
        if q.len() < 3 || q.len() > 40 {
            return out;
        }
        let digits = q.chars().all(|c| c.is_ascii_digit());
        if digits && q.len() <= 9 {
            for t in self.tins().await.into_iter().filter(|t| t.starts_with(q)).take(limit) {
                if let Some(c) = self.company(&t).await {
                    let hit = CompanyHit { kind: "company", key: t.clone(), tin: t, bills: c.bills, found: c.found, refreshed_at: c.refreshed_at };
                    out.push(serde_json::to_value(hit).unwrap_or(Value::Null));
                }
            }
        }
        let s = self.st.read().await;
        let mut hits = Vec::new();
        if digits && q.len() >= 6 {
            hits.extend(s.index.search_bills(q, limit));
        }
        if is_case_like(q) {
            hits.extend(s.index.search_cases(q, limit));
        }
        out.extend(hits.into_iter().map(|h| serde_json::to_value(h).unwrap_or(Value::Null)));
        out.truncate(limit);
        out
    }

    /// A company's cases (from its locator), newest registration first, filtered by a part of the number and a court type; one page.
    pub async fn company_cases(&self, tin: &str, q: &str, court: &str, offset: usize, limit: usize) -> CasePage {
        let mut list = { self.st.read().await.index.shard_cases(tin) };
        let mut courts: BTreeMap<String, usize> = BTreeMap::new();
        for r in &list {
            *courts.entry(r.1.clone()).or_default() += 1;
        }
        let q = q.trim();
        list.retain(|r| (court.is_empty() || r.1 == court) && (q.is_empty() || r.0.contains(q)));
        // newest first: registration year, then the running number
        let tail = |k: &str| k.rsplit('/').next().and_then(|n| n.parse::<u64>().ok()).unwrap_or(0);
        list.sort_by(|a, b| b.2.cmp(&a.2).then(tail(&b.0).cmp(&tail(&a.0))).then(b.0.cmp(&a.0)));
        let total = list.len();
        let rows = list.into_iter().skip(offset).take(limit).map(|r| CaseRef { key: r.0, court: r.1, year: r.2 }).collect();
        CasePage { total, rows, courts }
    }

    /// A company's bills of one year (a bucket), newest first, filtered by a text; one page.
    pub async fn company_bills(&self, tin: &str, year: u32, q: &str, offset: usize, limit: usize) -> AppResult<BillPage> {
        let t = self.bucket_text(&format!("bills:{tin}:{year}")).await.map_err(Self::upstream)?.ok_or_else(|| AppError::NotFound("Bu yil uchun kvitansiyalar zaxirada yoʻq".into()))?;
        let q = q.trim().to_lowercase();
        let mut list: Vec<(i64, Bill)> = Vec::new();
        let (mut sum, mut paid) = (0i64, 0i64);
        for r in rows(&t) {
            if !q.is_empty() && !serde_json::to_string(&r).unwrap_or_default().to_lowercase().contains(&q) {
                continue;
            }
            sum += r.get(4).and_then(|v| v.as_i64()).unwrap_or(0);
            paid += r.get(5).and_then(|v| v.as_i64()).unwrap_or(0);
            list.push((r.get(3).and_then(|v| v.as_i64()).unwrap_or(0), bill_of(&r)));
        }
        list.sort_by(|a, b| b.0.cmp(&a.0));
        let total = list.len();
        Ok(BillPage { total, rows: list.into_iter().skip(offset).take(limit).map(|x| x.1).collect(), sum, paid })
    }

    /// One case: its stored detail, its list row, and its bills (the registration year and the years around it).
    pub async fn case_view(&self, num: &str) -> AppResult<CaseView> {
        let entries = { self.st.read().await.index.case(num).cloned() }.ok_or_else(|| AppError::NotFound("Bunday ish raqami zaxirada yoʻq".into()))?;
        let e = entries.first().cloned().ok_or_else(|| AppError::NotFound("Bunday ish raqami zaxirada yoʻq".into()))?;
        let mut detail = Value::Null;
        if let Some(t) = self.bucket_text(&format!("details:{}:{}", e.court, e.yy)).await.map_err(Self::upstream)? {
            for r in rows(&t).into_iter().filter(|r| str_at(r, 1) == num) {
                if let Some(j) = base64_gunzip_json(str_at(&r, 3)) {
                    detail = j;
                }
                break;
            }
        }
        let mut row = Value::Null;
        if let Some(t) = self.bucket_text(&format!("found:{}:{}:{}", e.tin, e.court, e.yy)).await.map_err(Self::upstream)? {
            for r in rows(&t).into_iter().filter(|r| str_at(r, 2) == num) {
                row = serde_json::from_str(str_at(&r, 6)).unwrap_or(Value::Null);
                break;
            }
        }
        // a case the company's TIN lists show but nothing found by number: the list row (status, parties, next hearing)
        if row.is_null() {
            if let Some(t) = self.bucket_text(&format!("lists:{}", e.tin)).await.map_err(Self::upstream)? {
                for r in rows(&t).into_iter().filter(|r| str_at(r, 1) == num) {
                    row = serde_json::from_str(str_at(&r, 2)).unwrap_or(Value::Null);
                    break;
                }
            }
        }
        let mut bills = Vec::new();
        for year in [2000 + e.yy, 2001 + e.yy, (2000 + e.yy).saturating_sub(1)] {
            if let Some(t) = self.bucket_text(&format!("bills:{}:{}", e.tin, year)).await.map_err(Self::upstream)? {
                bills.extend(rows(&t).into_iter().filter(|r| str_at(r, 14) == num).map(|r| bill_of(&r)));
            }
        }
        Ok(CaseView { num: num.to_string(), court: e.court.clone(), tin: e.tin.clone(), year: e.yy, detail, row, bills, companies: entries.iter().map(|x| x.tin.clone()).collect() })
    }

    pub async fn bill_view(&self, number: &str) -> AppResult<Bill> {
        let e = { self.st.read().await.index.bill(number).cloned() }.ok_or_else(|| AppError::NotFound("Bunday kvitansiya zaxirada yoʻq".into()))?;
        let t = self.bucket_text(&format!("bills:{}:{}", e.tin, e.year)).await.map_err(Self::upstream)?.ok_or_else(|| AppError::NotFound("Kvitansiya boʻlagi zaxirada yoʻq".into()))?;
        rows(&t).into_iter().find(|r| str_at(r, 1) == number).map(|r| bill_of(&r)).ok_or_else(|| AppError::NotFound("Kvitansiya topilmadi".into()))
    }
}

fn base64_gunzip_json(b64: &str) -> Option<Value> {
    use base64::Engine;
    let gz = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    serde_json::from_slice(&gunzip(&gz)?).ok()
}
