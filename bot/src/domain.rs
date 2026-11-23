//! What the bot answers, as typed values. These structs ARE the API schema of the Mini App (`static/js/core/api.js`): a renamed field is a compile
//! error here and a failing test, not a silent blank on a phone. Court data of unknown shape (a case's detail, a list row) stays a JSON value.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub tin: String,
    /// the company's name in the courts' spelling (Cyrillic or Latin); "" when the backup does not know it
    pub name: String,
    /// bills with a case, cases found by number, cases the court lists show
    pub bills: usize,
    pub found: usize,
    pub listed: usize,
    pub years: Vec<String>,
    /// how many bills (with a case) each year holds, newest year first: the «Toʻlovlar» tab shows them without opening a bucket
    pub bill_years: Vec<YearBills>,
    /// epoch ms; 0 = not known
    pub first_at: i64,
    pub refreshed_at: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YearBills {
    pub year: u32,
    pub bills: usize,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YearCount {
    pub year: u32,
    pub cases: usize,
    pub bills: usize,
}

/// the company dashboard: its numbers plus how its cases spread over courts and registration years
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    #[serde(flatten)]
    pub company: Company,
    pub cases: usize,
    pub courts: BTreeMap<String, usize>,
    pub by_year: Vec<YearCount>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bill {
    pub tin: Value,
    pub number: Value,
    pub status: Value,
    pub issued: Value,
    pub amount: Value,
    pub paid: Value,
    pub must_pay: Value,
    pub balance: Value,
    pub overdue: Value,
    pub cat: Value,
    pub court: Value,
    pub court_type: Value,
    pub case_number: Value,
    pub payer: Value,
    pub payer_tin: Value,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaseView {
    pub num: String,
    pub court: String,
    pub tin: String,
    pub year: u32,
    /// the stored detail (general, instances), null when only the number is known
    pub detail: Value,
    /// the list row (status, parties, next hearing), null when none
    pub row: Value,
    pub bills: Vec<Bill>,
    /// every company whose backup knows this number
    pub companies: Vec<String>,
    /// the first company's name, its side in this case ("plaintiff" | "defendant" | "") and the other party; decided by the parties' TINs when the detail
    /// names them, else by the names
    pub company_name: String,
    pub role: &'static str,
    pub counterparty: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaseRef {
    pub key: String,
    pub court: String,
    pub year: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CasePage {
    pub total: usize,
    pub rows: Vec<CaseRef>,
    /// cases per court type (for the filter chips; not narrowed by the filters)
    pub courts: BTreeMap<String, usize>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BillPage {
    pub total: usize,
    pub rows: Vec<Bill>,
    pub sum: i64,
    pub paid: i64,
}

/// a company in the search results (cases and bills are `index::Hit`s; all three carry `kind`)
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompanyHit {
    pub kind: &'static str,
    pub key: String,
    pub tin: String,
    pub name: String,
    pub bills: usize,
    pub found: usize,
    pub refreshed_at: i64,
}

/// the state of the bot, for `/health` and the Mini App's hint line
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub ready: bool,
    pub error: Option<String>,
    pub indexed: usize,
    pub companies: usize,
    pub backup_at: Option<String>,
    pub synced_at: i64,
    pub failures: u32,
    /// which channel the data is read from: 0 = the main one, 1.. = a mirror (the main one is down or has no readable manifest)
    pub channel: usize,
    pub channels: usize,
    /// why the main channel is not used, when a mirror is
    pub degraded: Option<String>,
}

/// an upcoming hearing (from a company's `hearings:<tin>` bucket)
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hearing {
    pub tin: String,
    pub case_number: String,
    pub court: String,
    /// yyyymmdd
    pub day: u32,
    pub time: String,
    /// first | appeal | cassation | inspection | "" (not known)
    pub stage: String,
    pub status: String,
    pub plaintiff: String,
    pub defendant: String,
    /// the company's side: "plaintiff" | "defendant" | "" (not known), and the other party's name
    pub role: &'static str,
    pub counterparty: String,
}

/// one company's share of the hearings in a range (a card in the «Majlislar» tab)
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HearingCompany {
    pub tin: String,
    pub count: usize,
    /// the company's first hearing in the range
    pub next_day: u32,
    pub next_time: String,
}

/// a page of the upcoming hearings, with what the tab needs around it: the company cards and the count behind every range chip
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HearingPage {
    pub today: u32,
    pub days: u32,
    /// all rows of the range that match the company and the text filter
    pub total: usize,
    pub rows: Vec<Hearing>,
    /// per company, over the range and the text filter (NOT narrowed by the company filter: they are the way to choose one)
    pub companies: Vec<HearingCompany>,
    /// days → how many hearings fall in the first `days` days (today included), for the company and text filter
    pub ranges: BTreeMap<u32, usize>,
}
