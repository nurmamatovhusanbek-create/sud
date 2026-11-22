//! The locator in memory: every case number and bill number of every company, searched by prefix. One shard per company (the app's `index:<tin>` bucket),
//! replaced as a whole when its bucket id changes.

use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Debug)]
pub struct CaseEntry {
    pub tin: String,
    pub court: String,
    pub yy: u32,
}

#[derive(Clone, Debug)]
pub struct BillEntry {
    pub tin: String,
    pub year: u32,
    pub case: String,
}

struct Shard {
    id: String,
    cases: Vec<String>,
    bills: Vec<String>,
}

#[derive(Default)]
pub struct Index {
    shards: HashMap<String, Shard>,
    cases: BTreeMap<String, Vec<CaseEntry>>,
    bills: BTreeMap<String, BillEntry>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub kind: &'static str,
    pub key: String,
    pub tin: String,
    pub court: String,
    pub year: u32,
    pub case_number: String,
}

impl Index {
    pub fn shard_id(&self, tin: &str) -> Option<&str> {
        self.shards.get(tin).map(|s| s.id.as_str())
    }
    pub fn tins(&self) -> Vec<String> {
        self.shards.keys().cloned().collect()
    }
    pub fn rows(&self) -> usize {
        self.cases.values().map(|v| v.len()).sum::<usize>() + self.bills.len()
    }

    pub fn remove(&mut self, tin: &str) {
        if let Some(s) = self.shards.remove(tin) {
            for k in s.cases {
                if let Some(v) = self.cases.get_mut(&k) {
                    v.retain(|e| e.tin != tin);
                    if v.is_empty() {
                        self.cases.remove(&k);
                    }
                }
            }
            for k in s.bills {
                if self.bills.get(&k).map(|e| e.tin == tin).unwrap_or(false) {
                    self.bills.remove(&k);
                }
            }
        }
    }

    /// `text` = the bucket's lines: `["c", number, court, yy]` and `["b", number, year, case]`
    pub fn replace(&mut self, tin: &str, id: &str, text: &str) {
        self.remove(tin);
        let mut shard = Shard { id: id.to_string(), cases: Vec::new(), bills: Vec::new() };
        for line in text.lines().filter(|l| !l.is_empty()) {
            let Ok(r) = serde_json::from_str::<Vec<Value>>(line) else { continue };
            if r.len() < 4 {
                continue;
            }
            let key = r[1].as_str().unwrap_or("").to_string();
            if key.is_empty() {
                continue;
            }
            match r[0].as_str() {
                Some("c") => {
                    self.cases.entry(key.clone()).or_default().push(CaseEntry { tin: tin.to_string(), court: r[2].as_str().unwrap_or("").to_string(), yy: r[3].as_u64().unwrap_or(0) as u32 });
                    shard.cases.push(key);
                }
                Some("b") => {
                    self.bills.insert(key.clone(), BillEntry { tin: tin.to_string(), year: r[2].as_u64().unwrap_or(0) as u32, case: r[3].as_str().unwrap_or("").to_string() });
                    shard.bills.push(key);
                }
                _ => {}
            }
        }
        self.shards.insert(tin.to_string(), shard);
    }

    pub fn search_cases(&self, prefix: &str, limit: usize) -> Vec<Hit> {
        let mut out = Vec::new();
        for (k, v) in self.cases.range(prefix.to_string()..) {
            if !k.starts_with(prefix) {
                break;
            }
            for e in v {
                if out.len() >= limit {
                    return out;
                }
                out.push(Hit { kind: "case", key: k.clone(), tin: e.tin.clone(), court: e.court.clone(), year: e.yy, case_number: k.clone() });
            }
        }
        out
    }

    pub fn search_bills(&self, prefix: &str, limit: usize) -> Vec<Hit> {
        let mut out = Vec::new();
        for (k, e) in self.bills.range(prefix.to_string()..) {
            if !k.starts_with(prefix) || out.len() >= limit {
                break;
            }
            out.push(Hit { kind: "bill", key: k.clone(), tin: e.tin.clone(), court: String::new(), year: e.year, case_number: e.case.clone() });
        }
        out
    }

    /// every case number of a company with its court and registration year (the company page lists them)
    pub fn shard_cases(&self, tin: &str) -> Vec<(String, String, u32)> {
        let Some(sh) = self.shards.get(tin) else { return Vec::new() };
        let mut out = Vec::with_capacity(sh.cases.len());
        for k in &sh.cases {
            if let Some(v) = self.cases.get(k) {
                if let Some(e) = v.iter().find(|e| e.tin == tin) {
                    out.push((k.clone(), e.court.clone(), e.yy));
                }
            }
        }
        out
    }

    pub fn bill(&self, number: &str) -> Option<&BillEntry> {
        self.bills.get(number)
    }
    pub fn case(&self, number: &str) -> Option<&Vec<CaseEntry>> {
        self.cases.get(number)
    }
}

/// what the search box means: a case number (has `-` or `/`), digits (a STIR up to 9, a bill number from 6)
pub fn is_case_like(q: &str) -> bool {
    q.chars().all(|c| c.is_ascii_digit() || c == '-' || c == '/') && (q.contains('-') || q.contains('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "[\"c\",\"2-1004-2403/1\",\"civil\",24]\n[\"c\",\"2-1004-2411/2\",\"civil\",24]\n[\"b\",\"260880770031\",2024,\"2-1004-2403/1\"]\n";
    const B: &str = "[\"c\",\"2-1004-2403/1\",\"economic\",24]\n[\"b\",\"260880770099\",2025,\"\"]\n";

    #[test]
    fn prefix_search_over_cases_and_bills() {
        let mut ix = Index::default();
        ix.replace("111111111", "id1", A);
        assert_eq!(ix.search_cases("2-1004-24", 10).len(), 2);
        assert_eq!(ix.search_cases("2-1004-2411", 10)[0].key, "2-1004-2411/2");
        assert!(ix.search_cases("9-", 10).is_empty());
        let b = ix.search_bills("2608807", 10);
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].case_number, "2-1004-2403/1");
        assert_eq!(ix.rows(), 3);
    }

    #[test]
    fn the_same_case_in_two_companies_gives_two_hits_and_a_shard_is_replaced_whole() {
        let mut ix = Index::default();
        ix.replace("111111111", "id1", A);
        ix.replace("222222222", "id2", B);
        assert_eq!(ix.search_cases("2-1004-2403/1", 10).len(), 2);
        // company 1 changes: its old rows go, the other company's stay
        ix.replace("111111111", "id1b", "[\"c\",\"2-1004-2509/9\",\"civil\",25]\n");
        assert_eq!(ix.shard_id("111111111"), Some("id1b"));
        assert_eq!(ix.search_cases("2-1004-2403/1", 10).len(), 1);
        assert_eq!(ix.search_cases("2-1004-2403/1", 10)[0].tin, "222222222");
        assert!(ix.search_bills("260880770031", 5).is_empty());
        ix.remove("222222222");
        assert_eq!(ix.rows(), 1);
    }

    #[test]
    fn a_company_lists_its_own_cases() {
        let mut ix = Index::default();
        ix.replace("111111111", "id1", A);
        ix.replace("222222222", "id2", B);
        let mut l = ix.shard_cases("111111111");
        l.sort();
        assert_eq!(l, vec![("2-1004-2403/1".to_string(), "civil".to_string(), 24), ("2-1004-2411/2".to_string(), "civil".to_string(), 24)]);
        assert_eq!(ix.shard_cases("222222222")[0].1, "economic");
        assert!(ix.shard_cases("999999999").is_empty());
    }

    #[test]
    fn limit_and_query_kinds() {
        let mut ix = Index::default();
        ix.replace("111111111", "id1", A);
        assert_eq!(ix.search_cases("2-", 1).len(), 1);
        assert!(is_case_like("2-1004-24"));
        assert!(!is_case_like("2608807"));
        assert!(!is_case_like("abc-1"));
    }
}
