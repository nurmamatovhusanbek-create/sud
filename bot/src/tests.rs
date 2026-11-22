//! End-to-end tests of the bot over an in-memory channel: sync, the typed answers, the HTTP router (auth, rate limit, shapes) and the chat handlers.

use crate::config::Config;
use crate::state::now;
use crate::testkit::*;
use axum::{body::Body, http::{Request, StatusCode}};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tower::ServiceExt;

async fn get(sh: &std::sync::Arc<crate::state::Shared>, uri: &str, init: Option<&str>) -> (StatusCode, Value) {
    let mut r = Request::builder().uri(uri);
    if let Some(i) = init {
        r = r.header("x-init-data", i);
    }
    let res = crate::http::router(sh.clone()).oneshot(r.body(Body::empty()).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 10_000_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn signed(user: i64) -> String {
    init_data(&Config::for_tests().token, user, now())
}

mod sync {
    use super::*;

    #[tokio::test]
    async fn reads_the_pinned_backup_and_builds_the_locator() {
        let (sh, _b) = ready_bot().await;
        let i = sh.info().await;
        assert!(i.ready && i.error.is_none() && i.failures == 0);
        assert_eq!(i.companies, 2);
        assert_eq!(i.indexed, 4 + 1); // 3 cases + 1 bill of the first company, 1 case of the other
    }

    #[tokio::test]
    async fn an_unchanged_pin_downloads_nothing_and_a_new_backup_only_the_changed_index() {
        let (sh, b) = ready_bot().await;
        let before = b.channel.downloads.load(Ordering::SeqCst);
        assert_eq!(sh.sync().await.unwrap(), "oʻzgarmagan");
        assert_eq!(b.channel.downloads.load(Ordering::SeqCst), before);

        // a second backup: the first company's locator grew by one case, the other company is untouched
        publish(&b.channel, &b.pass, 2, &buckets(true));
        let msg = sh.sync().await.unwrap();
        assert!(msg.contains("1 ta indeks"), "{msg}");
        // the manifest itself + one index bucket
        assert_eq!(b.channel.downloads.load(Ordering::SeqCst), before + 2);
        assert_eq!(sh.search("2-1004-2603", 5).await.len(), 1);
    }

    #[tokio::test]
    async fn a_wrong_passphrase_is_reported_and_nothing_is_served() {
        let b = backup();
        let mut cfg = Config::for_tests();
        cfg.pass = "a completely different phrase".into();
        let sh = crate::state::Shared::with(cfg, crate::telegram::Source::Memory(b.channel.clone()), crate::telegram::Outbox::Capture(Default::default()));
        let e = sh.sync().await.unwrap_err();
        assert!(e.to_string().to_lowercase().contains("parol"), "{e}");
        assert!(!sh.info().await.ready);
    }

    #[tokio::test]
    async fn a_missing_pin_is_an_error_not_a_panic() {
        let sh = bot(&Backup { channel: Default::default(), pass: String::new() });
        assert!(sh.sync().await.is_err());
    }

    #[tokio::test]
    async fn a_company_that_left_the_backup_leaves_the_locator() {
        let (sh, b) = ready_bot().await;
        let only_first: Vec<_> = buckets(false).into_iter().filter(|(n, _)| !n.ends_with(OTHER_TIN)).collect();
        publish(&b.channel, &b.pass, 3, &only_first);
        sh.sync().await.unwrap();
        assert!(sh.search("2-1503-2503", 5).await.is_empty());
    }
}

mod service {
    use super::*;

    #[tokio::test]
    async fn search_finds_companies_cases_and_bills_by_prefix() {
        let (sh, _b) = ready_bot().await;
        let kinds = |hits: &[Value]| hits.iter().map(|h| h["kind"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(kinds(&sh.search("207", 10).await), ["company", "company"]);
        assert_eq!(kinds(&sh.search("260880770031", 10).await), ["bill"]);
        assert_eq!(kinds(&sh.search("2-1004-2503", 10).await), ["case", "case"]);
        assert!(sh.search("ab", 10).await.is_empty());
        assert!(sh.search("999999999", 10).await.is_empty());
    }

    #[tokio::test]
    async fn overview_counts_cases_by_court_and_year() {
        let (sh, _b) = ready_bot().await;
        let o = sh.overview(TIN).await.unwrap();
        assert_eq!(o.cases, 3);
        assert_eq!(o.courts.get("civil"), Some(&2));
        assert_eq!(o.courts.get("economic"), Some(&1));
        let y25 = o.by_year.iter().find(|y| y.year == 2025).unwrap();
        assert_eq!((y25.cases, y25.bills), (2, 2));
        assert!(sh.overview("111111111").await.is_err());
    }

    #[tokio::test]
    async fn a_case_has_its_detail_row_and_bills() {
        let (sh, _b) = ready_bot().await;
        let c = sh.case_view(CASE).await.unwrap();
        assert_eq!(c.detail["general"]["plaintiff"], "Daʼvogar MCHJ");
        assert_eq!(c.bills.len(), 1);
        assert_eq!(c.tin, TIN);
        // a case with no stored detail but a list row
        let c2 = sh.case_view("2-1004-2503/8021").await.unwrap();
        assert!(c2.detail.is_null());
        assert_eq!(c2.row["caseStatus"], "Ijroda");
        assert!(sh.case_view("9-9999-9999/1").await.is_err());
    }

    #[tokio::test]
    async fn bills_page_newest_first_with_sums() {
        let (sh, _b) = ready_bot().await;
        let p = sh.company_bills(TIN, 2025, "", 0, 10).await.unwrap();
        assert_eq!(p.total, 2);
        assert_eq!(p.rows[0].number, BILL);
        assert_eq!(p.sum, 206_100_000);
        assert_eq!(sh.company_bills(TIN, 2025, "260880770032", 0, 10).await.unwrap().total, 1);
        assert!(sh.company_bills(TIN, 1999, "", 0, 10).await.is_err());
        assert_eq!(sh.bill_view(BILL).await.unwrap().case_number, CASE);
    }

    #[tokio::test]
    async fn case_pages_filter_by_court_and_text() {
        let (sh, _b) = ready_bot().await;
        let all = sh.company_cases(TIN, "", "", 0, 10).await;
        assert_eq!(all.total, 3);
        assert_eq!(all.rows[0].year, 25); // newest registration first
        assert_eq!(sh.company_cases(TIN, "", "economic", 0, 10).await.total, 1);
        assert_eq!(sh.company_cases(TIN, "8020", "", 0, 10).await.total, 1);
        // the chips are not narrowed by the filter
        assert_eq!(sh.company_cases(TIN, "8020", "", 0, 10).await.courts.len(), 2);
    }

    #[tokio::test]
    async fn concurrent_asks_for_one_bucket_download_it_once() {
        let (sh, b) = ready_bot().await;
        let before = b.channel.downloads.load(Ordering::SeqCst);
        let name = format!("bills:{TIN}:2025");
        let (a, c) = tokio::join!(sh.bucket_text(&name), sh.bucket_text(&name));
        assert!(a.unwrap().is_some() && c.unwrap().is_some());
        assert_eq!(b.channel.downloads.load(Ordering::SeqCst), before + 1);
    }
}

mod http {
    use super::*;

    #[tokio::test]
    async fn health_is_public_and_the_api_is_not() {
        let (sh, _b) = ready_bot().await;
        assert_eq!(get(&sh, "/health", None).await.0, StatusCode::OK);
        let (st, body) = get(&sh, "/api/companies", None).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        assert_eq!(body["ok"], false);
        assert_eq!(get(&sh, "/api/companies", Some("hash=00&auth_date=1")).await.0, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_signed_user_off_the_list_is_forbidden_and_one_on_it_is_served() {
        let (sh, _b) = ready_bot().await;
        assert_eq!(get(&sh, "/api/companies", Some(&signed(1))).await.0, StatusCode::FORBIDDEN);
        let (st, body) = get(&sh, "/api/companies", Some(&signed(4242))).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body["companies"].as_array().unwrap().len(), 2);
        assert_eq!(body["companies"][0]["tin"], TIN); // the larger first
    }

    #[tokio::test]
    async fn stale_launch_data_and_a_foreign_token_are_refused() {
        let (sh, _b) = ready_bot().await;
        let old = init_data(&Config::for_tests().token, 4242, now() - 3 * 24 * 3600);
        assert_eq!(get(&sh, "/api/companies", Some(&old)).await.0, StatusCode::UNAUTHORIZED);
        let foreign = init_data("999:AAOtherOtherOtherOtherOtherOtherOth", 4242, now());
        assert_eq!(get(&sh, "/api/companies", Some(&foreign)).await.0, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn the_endpoints_answer_in_the_shape_the_mini_app_reads() {
        let (sh, _b) = ready_bot().await;
        let i = signed(4242);
        let (_, o) = get(&sh, &format!("/api/overview?tin={TIN}"), Some(&i)).await;
        assert_eq!(o["overview"]["cases"], 3);
        assert_eq!(o["overview"]["byYear"][0]["year"], 2024);
        let (_, s) = get(&sh, "/api/search?q=2-1004-2503", Some(&i)).await;
        assert_eq!(s["hits"][0]["kind"], "case");
        assert_eq!(s["info"]["ready"], true);
        let (_, c) = get(&sh, &format!("/api/case?num={CASE}"), Some(&i)).await;
        assert_eq!(c["case"]["detail"]["general"]["plaintiff"], "Daʼvogar MCHJ");
        assert_eq!(c["case"]["bills"][0]["caseNumber"], CASE);
        let (_, b) = get(&sh, &format!("/api/bill?num={BILL}"), Some(&i)).await;
        assert_eq!(b["bill"]["number"], BILL);
        let (_, cc) = get(&sh, &format!("/api/company/cases?tin={TIN}&limit=1"), Some(&i)).await;
        assert_eq!((cc["cases"]["total"].as_u64(), cc["cases"]["rows"].as_array().unwrap().len()), (Some(3), 1));
        let (_, cb) = get(&sh, &format!("/api/company/bills?tin={TIN}&year=2025"), Some(&i)).await;
        assert_eq!(cb["bills"]["total"], 2);
    }

    #[tokio::test]
    async fn bad_input_is_a_400_or_404_with_a_sentence() {
        let (sh, _b) = ready_bot().await;
        let i = signed(4242);
        let (st, b) = get(&sh, "/api/overview?tin=12", Some(&i)).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        assert!(b["error"].as_str().unwrap().contains("STIR"));
        assert_eq!(get(&sh, "/api/case?num=nope", Some(&i)).await.0, StatusCode::NOT_FOUND);
        assert_eq!(get(&sh, "/api/company?tin=111111111", Some(&i)).await.0, StatusCode::NOT_FOUND);
        assert_eq!(get(&sh, "/api/nothing", Some(&i)).await.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn one_person_is_limited_per_minute() {
        let mut cfg = Config::for_tests();
        cfg.rate_per_minute = 3;
        let b = backup();
        let sh = crate::state::Shared::with(cfg, crate::telegram::Source::Memory(b.channel.clone()), crate::telegram::Outbox::Capture(Default::default()));
        sh.sync().await.unwrap();
        let i = signed(4242);
        for _ in 0..3 {
            assert_eq!(get(&sh, "/api/companies", Some(&i)).await.0, StatusCode::OK);
        }
        assert_eq!(get(&sh, "/api/companies", Some(&i)).await.0, StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn the_page_is_served_with_a_strict_policy() {
        let (sh, _b) = ready_bot().await;
        let res = crate::http::router(sh).oneshot(Request::builder().uri("/app").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let csp = res.headers()["content-security-policy"].to_str().unwrap().to_string();
        assert!(csp.contains("default-src 'none'") && !csp.contains("unsafe-inline"));
    }

    #[tokio::test]
    async fn static_paths_cannot_leave_the_folder() {
        let (sh, _b) = ready_bot().await;
        for p in ["/static/../Cargo.toml", "/static/%2e%2e/Cargo.toml", "/static/nothing.js"] {
            assert_eq!(get(&sh, p, None).await.0, StatusCode::NOT_FOUND, "{p}");
        }
    }

    #[tokio::test]
    async fn the_webhook_needs_the_secret_in_the_path_and_the_header() {
        let (sh, _b) = ready_bot().await;
        let secret = Config::for_tests().webhook_secret;
        let post = |path: String, hdr: Option<&str>| {
            let mut r = Request::builder().method("POST").uri(path).header("content-type", "application/json");
            if let Some(h) = hdr {
                r = r.header("x-telegram-bot-api-secret-token", h);
            }
            crate::http::router(sh.clone()).oneshot(r.body(Body::from("{}")).unwrap())
        };
        assert_eq!(post(format!("/tg/{secret}"), Some(&secret)).await.unwrap().status(), StatusCode::OK);
        assert_eq!(post(format!("/tg/{secret}"), None).await.unwrap().status(), StatusCode::NOT_FOUND);
        assert_eq!(post("/tg/wrong".into(), Some(&secret)).await.unwrap().status(), StatusCode::NOT_FOUND);
    }
}

mod chat {
    use super::*;
    use crate::chat::handle_update;

    fn message(user: i64, text: &str) -> Value {
        json!({ "message": { "from": { "id": user }, "chat": { "id": user }, "text": text } })
    }

    #[tokio::test]
    async fn strangers_get_their_id_and_nothing_else() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(777, "2-1004-2503/8020")).await;
        let sent = sh.outbox.captured();
        assert_eq!(sent.len(), 1);
        assert!(sent[0].text.contains("777") && !sent[0].text.contains("Daʼvogar"));
    }

    #[tokio::test]
    async fn a_case_number_answers_with_the_case_and_a_mini_app_button() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, &format!("/case {CASE}"))).await;
        let sent = sh.outbox.captured();
        assert!(sent[0].text.contains("Daʼvogar: Daʼvogar MCHJ") && sent[0].text.contains("Daʼvo qanoatlantirilsin"));
        assert!(!sent[0].text.contains("Javobgar")); // "-" is hidden
        assert_eq!(sent[0].markup.as_ref().unwrap()["inline_keyboard"][0][0]["web_app"]["url"], "https://bot.example/app?case=2-1004-2503%2F8020");
    }

    #[tokio::test]
    async fn plain_text_searches_and_buttons_open_the_item() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, "2-1004-2503")).await;
        let kb = sh.outbox.captured()[0].markup.clone().unwrap();
        assert_eq!(kb["inline_keyboard"][0][0]["callback_data"], format!("c:{CASE}"));
        let cb = json!({ "callback_query": { "id": "1", "from": { "id": 4242 }, "message": { "chat": { "id": 4242 } }, "data": format!("b:{BILL}") } });
        handle_update(sh.clone(), cb).await;
        assert!(sh.outbox.captured()[1].text.contains("Kvitansiya 260880770031"));
    }

    #[tokio::test]
    async fn a_miss_explains_what_to_type() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, "zzzzzz")).await;
        assert!(sh.outbox.captured()[0].text.contains("Topilmadi"));
    }

    #[tokio::test]
    async fn before_the_backup_is_read_the_bot_says_so() {
        let b = backup();
        let sh = bot(&b);
        handle_update(sh.clone(), message(4242, "/status")).await;
        assert!(sh.outbox.captured()[0].text.contains("yuklanmoqda"));
        handle_update(sh.clone(), message(4242, "/help")).await; // help works without a backup
        assert!(sh.outbox.captured()[1].text.contains("/find"));
    }

    #[tokio::test]
    async fn a_chat_flood_is_cut_off() {
        let mut cfg = Config::for_tests();
        cfg.rate_per_minute = 2;
        let b = backup();
        let sh = crate::state::Shared::with(cfg, crate::telegram::Source::Memory(b.channel.clone()), crate::telegram::Outbox::Capture(Default::default()));
        sh.sync().await.unwrap();
        for _ in 0..3 {
            handle_update(sh.clone(), message(4242, "/status")).await;
        }
        assert!(sh.outbox.captured()[2].text.contains("Juda koʻp"));
    }

    #[test]
    fn dates_and_numbers() {
        assert_eq!(crate::chat::dmy_ms(1_774_827_370_376), "30.03.2026");
        assert_eq!(crate::chat::dmy_ms(0), "-");
    }
}
