//! What the bot answers, as typed values. These structs ARE the API schema of the Mini App (`static/js/core/api.js`): a renamed field is a compile
//! error here and a failing test, not a silent blank on a phone. Court data of unknown shape (a case's detail, a list row) stays a JSON value.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub tin: String,
    /// bills with a case, cases found by number, cases the court lists show
    pub bills: usize,
    pub found: usize,
    pub listed: usize,
    pub years: Vec<String>,
    /// epoch ms; 0 = not known
    pub first_at: i64,
    pub refreshed_at: i64,
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
}
