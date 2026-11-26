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
        publish(&b.channel, MAIN, &b.pass, 2, &buckets(true));
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
        publish(&b.channel, MAIN, &b.pass, 3, &only_first);
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

mod mirrors {
    use super::*;
    use crate::state::Shared;

    async fn ready_mirrored() -> (std::sync::Arc<Shared>, Backup) {
        let (b, cfg) = mirrored();
        let sh = bot_with(cfg, &b);
        sh.sync().await.expect("sync");
        (sh, b)
    }

    #[tokio::test]
    async fn with_a_healthy_main_channel_the_mirror_is_not_touched() {
        let (sh, _b) = ready_mirrored().await;
        let i = sh.info().await;
        assert_eq!((i.channel, i.channels, i.degraded), (0, 2, None));
    }

    #[tokio::test]
    async fn a_banned_main_channel_moves_the_bot_to_the_mirror_and_it_keeps_answering() {
        let (b, cfg) = mirrored();
        b.channel.kill(MAIN);
        let sh = bot_with(cfg, &b);
        let msg = sh.sync().await.unwrap();
        assert!(msg.contains(&format!("zaxira kanaldan ({MIRROR})")), "{msg}");
        let i = sh.info().await;
        assert!(i.ready && i.channel == 1 && i.degraded.as_deref().unwrap().contains(MAIN));
        assert_eq!(sh.search("2-1004-2503", 5).await.len(), 2);
        assert_eq!(sh.case_view(CASE).await.unwrap().detail["general"]["plaintiff"], "Daʼvogar MCHJ"); // buckets come from the mirror too
    }

    #[tokio::test]
    async fn a_deleted_manifest_message_or_a_deleted_index_piece_also_moves_it() {
        let (b, cfg) = mirrored();
        b.channel.unpin(MAIN);
        let sh = bot_with(cfg, &b);
        assert!(sh.sync().await.is_ok() && sh.info().await.channel == 1);

        let (b2, cfg2) = mirrored();
        let victim = b2.channel.files_of(MAIN).into_iter().find(|f| !f.starts_with("MANIFEST")).unwrap();
        b2.channel.delete_file(&victim);
        let sh2 = bot_with(cfg2, &b2);
        // some piece of the main channel is gone: if it is an index piece the sync falls over to the mirror, otherwise it is read on demand
        sh2.sync().await.expect("sync");
        assert_eq!(sh2.search("2-1004-2503", 5).await.len(), 2);
    }

    #[tokio::test]
    async fn a_piece_that_vanishes_later_is_read_from_the_mirror_on_demand() {
        let (sh, b) = ready_mirrored().await;
        for f in b.channel.files_of(MAIN).into_iter().filter(|f| !f.starts_with("MANIFEST")) {
            b.channel.delete_file(&f); // every piece of the main channel is gone while its manifest is still cached in memory
        }
        let p = sh.company_bills(TIN, 2025, "", 0, 10).await.unwrap();
        assert_eq!(p.total, 2);
        assert_eq!(sh.info().await.channel, 0); // still reading the main manifest: only this bucket came from the mirror
    }

    #[tokio::test]
    async fn once_on_the_mirror_an_unchanged_pin_downloads_nothing() {
        let (b, cfg) = mirrored();
        b.channel.kill(MAIN);
        let sh = bot_with(cfg, &b);
        sh.sync().await.unwrap();
        let before = b.channel.downloads.load(Ordering::SeqCst);
        assert_eq!(sh.sync().await.unwrap(), "oʻzgarmagan");
        assert_eq!(b.channel.downloads.load(Ordering::SeqCst), before);
        assert!(sh.info().await.degraded.is_some()); // and the health still says the main channel is not used
    }

    #[tokio::test]
    async fn a_wrong_passphrase_is_not_retried_on_the_mirror_and_all_channels_down_names_each() {
        let (b, mut cfg) = mirrored();
        cfg.pass = "a completely different phrase".into();
        let sh = bot_with(cfg, &b);
        assert!(matches!(sh.sync().await, Err(crate::backup::BackupError::WrongPassphrase)));

        let (b2, cfg2) = mirrored();
        b2.channel.kill(MAIN);
        b2.channel.kill(MIRROR);
        let sh2 = bot_with(cfg2, &b2);
        let e = sh2.sync().await.unwrap_err().to_string();
        assert!(e.contains(MAIN) && e.contains(MIRROR), "{e}");
        assert!(!sh2.info().await.ready);
    }

    #[tokio::test]
    async fn the_status_message_says_when_a_mirror_is_used() {
        let (b, cfg) = mirrored();
        b.channel.kill(MAIN);
        let sh = bot_with(cfg, &b);
        sh.sync().await.unwrap();
        crate::chat::handle_update(sh.clone(), json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": "/status" } })).await;
        assert!(sh.outbox.captured()[0].text.contains("zaxira kanaldan oʻqilmoqda"));
    }
}

mod names {
    use super::*;
    use crate::date::{add_days, today};

    #[tokio::test]
    async fn a_company_is_shown_by_its_name_everywhere() {
        let (sh, _b) = ready_bot().await;
        let i = signed(4242);
        let (_, c) = get(&sh, "/api/companies", Some(&i)).await;
        assert_eq!(c["companies"][0]["name"], "«ANOR» МЧЖ");
        assert_eq!(c["companies"][1]["name"], ""); // the other company: no bill names it
        let (_, o) = get(&sh, &format!("/api/overview?tin={TIN}"), Some(&i)).await;
        assert_eq!(o["overview"]["name"], "«ANOR» МЧЖ");
    }

    #[tokio::test]
    async fn the_search_finds_a_company_by_its_name_in_either_script() {
        let (sh, _b) = ready_bot().await;
        for q in ["anor", "АНОР", "ano", "«anor» mchj"] {
            let hits = sh.search(q, 10).await;
            assert_eq!(hits.len(), 1, "{q}: {hits:?}");
            assert_eq!((hits[0]["kind"].as_str(), hits[0]["tin"].as_str()), (Some("company"), Some(TIN)));
        }
        assert!(sh.search("mchj", 10).await.is_empty()); // a legal form is not a name
        assert!(sh.search("nothing", 10).await.is_empty());
    }

    #[tokio::test]
    async fn the_companys_side_is_decided_for_hearings_by_the_names() {
        let (sh, _b) = ready_bot().await;
        let t = today(now());
        let l = sh.hearings(t, add_days(t, 6)).await.unwrap();
        // the fixture's hearings: plaintiff «Универсал МЧЖ», defendant «ANOR МЧЖ»; the company is «ANOR» МЧЖ
        assert!(l.iter().all(|h| h.role == "defendant" && h.counterparty == "Универсал МЧЖ"), "{l:?}");
        crate::chat::handle_update(sh.clone(), json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": "/hearings 7" } })).await;
        let text = &sh.outbox.captured()[0].text;
        assert!(text.contains("· javobgar\n↔ Universal MChJ") && !text.contains("Universal MChJ — ANOR"), "{text}");
    }

    #[tokio::test]
    async fn a_tin_in_the_case_detail_decides_the_side_before_any_name() {
        let b = backup();
        let mut content = buckets(false);
        content.retain(|(n, _)| n != "details:civil:25");
        // the party names do NOT look like the company's name, but the defendant's TIN is the company's
        content.push(detail_bucket(CASE, json!({ "plaintiff": "Boshqa Kompaniya", "plaintiffTin": "201234567", "defendant": "Nomi boshqacha", "defendantTin": TIN })));
        publish(&b.channel, MAIN, &b.pass, 2, &content);
        let sh = bot(&b);
        sh.sync().await.unwrap();
        let c = sh.case_view(CASE).await.unwrap();
        assert_eq!((c.role, c.counterparty.as_str(), c.company_name.as_str()), ("defendant", "Boshqa Kompaniya", "«ANOR» МЧЖ"));
        crate::chat::handle_update(sh.clone(), json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": format!("/case {CASE}") } })).await;
        assert!(sh.outbox.captured()[0].text.contains("<b>«ANOR» MChJ</b> · javobgar\n↔ Boshqa Kompaniya"), "{}", sh.outbox.captured()[0].text);
    }

    #[tokio::test]
    async fn a_recorded_name_that_does_not_look_like_the_party_names_does_not_hide_the_side() {
        // the bills name a branch («ANOR» МЧЖ), the courts write the parent company as the defendant of every case: the learned name settles the side
        let b = backup();
        let t = today(now());
        let rows: Vec<String> = (0..6).map(|i| json!([format!("2-1004-2503/{}", 2000 + i), "civil", add_days(t, i), "10:00", "first", "Тайинлаш", format!("Firma{i} Savdo MChJ"), "Butunlay Boshqacha Nom AJ", 1]).to_string() + "\n").collect();
        let mut content = buckets(false);
        content.retain(|(n, _)| !n.starts_with("hearings:"));
        content.push((format!("hearings:{TIN}"), rows.concat()));
        publish(&b.channel, MAIN, &b.pass, 2, &content);
        let sh = bot(&b);
        sh.sync().await.unwrap();
        let l = sh.hearings(t, add_days(t, 6)).await.unwrap();
        assert_eq!(l.len(), 6);
        assert!(l.iter().all(|h| h.role == "defendant" && h.counterparty.starts_with("Firma")), "{l:?}");
        assert_eq!(sh.name_of(TIN).await, "«ANOR» МЧЖ"); // the displayed name is still the recorded one
    }

    #[tokio::test]
    async fn without_a_recorded_name_it_is_learned_from_the_cases() {
        let b = backup();
        publish_named(&b.channel, MAIN, &b.pass, 2, &buckets(false), None);
        let sh = bot(&b);
        sh.sync().await.unwrap();
        // every hearing of the fixture names «ANOR МЧЖ» as a party: that is the company
        assert_eq!(sh.name_of(TIN).await, "ANOR МЧЖ");
        let l = sh.hearings(today(now()), add_days(today(now()), 6)).await.unwrap();
        assert!(l.iter().all(|h| h.role == "defendant"));
        assert_eq!(sh.name_of(OTHER_TIN).await, ""); // a company with no hearings and no recorded name stays unnamed
    }

    #[tokio::test]
    async fn an_old_backup_without_names_still_works() {
        let (sh, _b) = ready_bot().await;
        let c = sh.company(OTHER_TIN).await.unwrap();
        assert_eq!(c.name, "");
        assert!(sh.search("2072", 5).await.iter().all(|h| h["kind"] != "company" || h["name"].is_string()));
    }
}

mod hearings {
    use super::*;
    use crate::date::{add_days, today};

    #[tokio::test]
    async fn the_week_ahead_is_sorted_and_leaves_out_the_past_and_the_far_future() {
        let (sh, _b) = ready_bot().await;
        let t = today(now());
        let l = sh.hearings(t, add_days(t, 7)).await.unwrap();
        assert_eq!(l.iter().map(|h| h.case_number.as_str()).collect::<Vec<_>>(), [CASE, "2-1004-2503/8021", "2-0001-2401/5"]);
        assert_eq!(l[0].time, "10:00");
        assert_eq!(sh.hearings(t, add_days(t, 60)).await.unwrap().len(), 4);
        assert!(sh.hearings(add_days(t, 6), add_days(t, 7)).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_page_carries_company_cards_and_range_counts() {
        let (sh, _b) = ready_bot().await;
        let t = today(now());
        let p = sh.hearing_page(t, 14, "", "", 0, 30).await.unwrap();
        assert_eq!((p.total, p.rows.len(), p.days), (3, 3, 14));
        assert_eq!(p.companies.len(), 1);
        assert_eq!((p.companies[0].tin.as_str(), p.companies[0].count, p.companies[0].next_day, p.companies[0].next_time.as_str()), (TIN, 3, t, "10:00"));
        // the chip counts: today 1, a week 3 (the third is five days away), 60 days 4 (the fortieth day), the past one is never counted
        assert_eq!((p.ranges[&1], p.ranges[&7], p.ranges[&14], p.ranges[&30], p.ranges[&60], p.ranges[&90]), (1, 3, 3, 3, 4, 4));
        // one day: only today
        assert_eq!(sh.hearing_page(t, 1, "", "", 0, 30).await.unwrap().total, 1);
    }

    #[tokio::test]
    async fn filters_by_company_and_by_text_in_latin_and_pages() {
        let (sh, _b) = ready_bot().await;
        let t = today(now());
        assert_eq!(sh.hearing_page(t, 60, OTHER_TIN, "", 0, 30).await.unwrap().total, 0); // the other company has none
        // the party's name is Cyrillic in the backup; the person types Latin
        assert_eq!(sh.hearing_page(t, 60, "", "universal", 0, 30).await.unwrap().total, 4);
        assert_eq!(sh.hearing_page(t, 60, "", "8021", 0, 30).await.unwrap().total, 1);
        assert_eq!(sh.hearing_page(t, 60, "", "nothing like it", 0, 30).await.unwrap().total, 0);
        // the company cards are not narrowed by the company filter (they are how one is chosen), but they follow the text
        let p = sh.hearing_page(t, 60, OTHER_TIN, "8021", 0, 30).await.unwrap();
        assert_eq!((p.total, p.companies.len()), (0, 1));
        let paged = sh.hearing_page(t, 60, "", "", 1, 2).await.unwrap();
        assert_eq!((paged.total, paged.rows.len(), paged.rows[0].case_number.as_str()), (4, 2, "2-1004-2503/8021"));
    }

    #[tokio::test]
    async fn the_api_answers_pages_and_refuses_a_bad_tin() {
        let (sh, _b) = ready_bot().await;
        let i = signed(4242);
        let (st, b) = get(&sh, "/api/hearings?days=7&limit=2", Some(&i)).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!((b["page"]["total"].as_u64(), b["page"]["rows"].as_array().unwrap().len()), (Some(3), 2));
        assert_eq!(b["page"]["rows"][0]["caseNumber"], CASE);
        assert_eq!(b["page"]["companies"][0]["tin"], TIN);
        assert_eq!(b["page"]["ranges"]["7"], 3);
        let (_, b) = get(&sh, "/api/hearings?days=9999", Some(&i)).await; // at most 90 days
        assert_eq!((b["page"]["days"].as_u64(), b["page"]["total"].as_u64()), (Some(90), Some(4)));
        assert_eq!(get(&sh, "/api/hearings?tin=12", Some(&i)).await.0, StatusCode::BAD_REQUEST);
        assert_eq!(get(&sh, "/api/hearings", None).await.0, StatusCode::UNAUTHORIZED);
    }

    /// a backup whose only hearings are `n` rows spread over the next days
    fn crowded(n: usize) -> (Backup, crate::config::Config) {
        let (b, cfg) = (backup(), crate::config::Config::for_tests());
        let t = today(now());
        let rows: Vec<String> = (0..n).map(|i| json!([format!("2-1004-2503/{}", 1000 + i), "civil", add_days(t, (i % 10) as i64), format!("{:02}:00", 9 + i % 8), "first", "Тайинлаш", "Универсал Савдо МЧЖ", "ANOR TEXTILE МЧЖ", 1]).to_string() + "\n").collect();
        let mut content = buckets(false);
        content.retain(|(name, _)| !name.starts_with("hearings:"));
        content.push((format!("hearings:{TIN}"), rows.concat()));
        publish(&b.channel, MAIN, &b.pass, 2, &content);
        (b, cfg)
    }

    #[tokio::test]
    async fn a_hundred_hearings_go_out_in_pages_that_fit_a_telegram_message() {
        let (b, cfg) = crowded(100);
        let sh = bot_with(cfg, &b);
        sh.sync().await.unwrap();
        crate::chat::handle_update(sh.clone(), json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": "/hearings 14" } })).await;
        let first = sh.outbox.captured()[0].clone();
        assert!(first.text.len() < 4096 && first.text.contains("<b>100</b> ta · 1–10"), "{}", first.text);
        let kb = first.markup.unwrap();
        assert_eq!(kb["inline_keyboard"][0][0]["callback_data"], "h:14::10");
        assert!(kb["inline_keyboard"][0][0]["text"].as_str().unwrap().contains("Keyingi 10"));
        assert!(kb["inline_keyboard"][1][0]["web_app"]["url"].as_str().unwrap().ends_with("/app?tab=hearings"));
        // the «next» button asks for the following page, and the last page has no «next»
        for (offset, last) in [(10, false), (30, false), (50, false), (70, false), (90, true)] {
            let cb = json!({ "callback_query": { "id": "1", "from": { "id": 4242 }, "message": { "chat": { "id": 4242 } }, "data": format!("h:14::{offset}") } });
            crate::chat::handle_update(sh.clone(), cb).await;
            let m = sh.outbox.captured().last().unwrap().clone();
            assert!(m.text.contains(&format!("{}–{}", offset + 1, offset + 10)) && m.text.len() < 4096);
            assert_eq!(m.markup.unwrap()["inline_keyboard"][0][0]["callback_data"].is_string(), !last);
        }
    }

    #[tokio::test]
    async fn the_command_takes_days_and_a_company() {
        let (sh, _b) = ready_bot().await;
        let say = |text: &str| crate::chat::handle_update(sh.clone(), json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": text } }));
        say("/hearings 1").await;
        say(&format!("/hearings 30 {OTHER_TIN}")).await;
        say(&format!("/hearings {TIN}")).await;
        let sent = sh.outbox.captured();
        assert!(sent[0].text.contains("1 kun") && sent[0].text.contains("<b>1</b> ta"), "{}", sent[0].text);
        assert!(sent[1].text.contains("Yaqin 30 kunda majlis yoʻq") && sent[1].text.contains(OTHER_TIN));
        assert!(sent[2].text.contains(&format!("STIR {TIN}")) && sent[2].text.contains("<b>3</b> ta"), "{}", sent[2].text);
    }

    #[tokio::test]
    async fn the_chat_command_lists_them_in_latin() {
        let (sh, _b) = ready_bot().await;
        crate::chat::handle_update(sh.clone(), json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": "/hearings" } })).await;
        let t = &sh.outbox.captured()[0].text;
        assert!(t.contains("Bugun") && t.contains("Ertaga") && t.contains(CASE) && t.contains("Universal MChJ") && !t.contains("МЧЖ"), "{t}");
        assert!(!t.contains("2-1004-2603/1")); // forty days away: not in the 14-day list
    }

    #[tokio::test]
    async fn the_morning_message_goes_to_every_allowed_person_and_only_when_there_is_something() {
        let (sh, _b) = ready_bot().await;
        let t = today(now());
        let list = sh.hearings(t, add_days(t, 6)).await.unwrap();
        let body = crate::digest::text(&list, t, Some("2026-11-22T10:00:00.000Z")).unwrap();
        assert!(body.starts_with("📋 <b>Yaqin majlislar</b>\nKeyingi 7 kun: <b>3 ta</b>"), "{body}");
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
        assert!(sent[0].text.contains("<b>Daʼvogar:</b> Daʼvogar M") && sent[0].text.contains("Daʼvo qanoatlantirilsin"), "{}", sent[0].text);
        assert!(!sent[0].text.contains("<b>Javobgar:</b>")); // "-" is hidden
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
        assert!(sh.outbox.captured()[1].text.contains("Kvitansiya</b> <code>260880770031</code>"), "{}", sh.outbox.captured()[1].text);
    }

    #[tokio::test]
    async fn stats_counts_every_company_or_one_company_by_court_and_year() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, "/stats")).await;
        handle_update(sh.clone(), message(4242, &format!("/stats {TIN}"))).await;
        let sent = sh.outbox.captured();
        assert!(sent[0].text.contains("Umumiy sonlar") && sent[0].text.contains("Kompaniyalar: <b>") && sent[0].text.contains(TIN), "{}", sent[0].text);
        assert!(sent[1].text.contains("Sudlar boʻyicha") && sent[1].text.contains("Yillar boʻyicha") && sent[1].text.contains(&format!("STIR {TIN}")), "{}", sent[1].text);
        assert!(sent[1].text.len() < 4096);
    }

    fn fake_overview(i: usize) -> crate::domain::Overview {
        crate::domain::Overview {
            company: crate::domain::Company { tin: format!("{}", 200_000_000 + i), name: format!("«SHIRKAT NOMI JUDA UZUN BOʻLGAN JAMIYAT {i}» MAS'ULIYATI CHEKLANGAN JAMIYAT"), bills: 70_000 + i, found: 40_000, ..Default::default() },
            cases: 40_000 + i,
            courts: Default::default(),
            by_year: vec![],
        }
    }

    #[test]
    fn stats_pages_stay_under_telegrams_limit_and_the_buttons_walk_the_list() {
        use crate::chat::{stats_keys, stats_text};
        let rows: Vec<_> = (0..10).map(fake_overview).collect();
        let t = stats_text(&rows, 95, 20);
        assert!(t.len() < 3900, "{}", t.len());
        assert!(t.contains("Kompaniyalar: <b>95</b> · 21-30 koʻrsatilmoqda"), "{t}");
        assert!(stats_text(&rows[..3], 3, 0).contains("Kompaniyalar: <b>3</b>\n") && !stats_text(&rows[..3], 3, 0).contains("koʻrsatilmoqda"));
        assert!(stats_keys(10, 0).is_none());
        let first = stats_keys(95, 0).unwrap().to_string();
        assert!(first.contains("1/10") && first.contains("t:10") && !first.contains("Oldingi"), "{first}");
        let mid = stats_keys(95, 40).unwrap().to_string();
        assert!(mid.contains("t:30") && mid.contains("t:50") && mid.contains("5/10"), "{mid}");
        let last = stats_keys(95, 90).unwrap().to_string();
        assert!(last.contains("t:80") && last.contains("10/10") && !last.contains("Keyingi"), "{last}");
    }

    #[tokio::test]
    async fn a_stats_button_redraws_the_same_message_and_a_stale_page_falls_back() {
        let (sh, _b) = ready_bot().await;
        let cb = |data: &str| json!({ "callback_query": { "id": "1", "from": { "id": 4242 }, "message": { "message_id": 77, "chat": { "id": 4242 } }, "data": data } });
        handle_update(sh.clone(), cb("t:0")).await;
        handle_update(sh.clone(), cb("t:900")).await; // the list is shorter now
        handle_update(sh.clone(), cb("t:zzz")).await; // nonsense
        let edited = sh.outbox.edited();
        assert_eq!(edited.len(), 2, "{edited:?}");
        assert!(edited.iter().all(|e| e.id == 77 && e.text.contains("Umumiy sonlar") && e.text.contains(TIN)), "{edited:?}");
    }

    #[tokio::test]
    async fn help_is_formatted_and_lists_every_command() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, "/help")).await;
        let t = &sh.outbox.captured()[0].text;
        for c in ["/hearings", "/stats", "/company", "/case", "/bill", "/find", "/app", "/status"] {
            assert!(t.contains(c), "{c}");
        }
        assert!(t.starts_with("<b>Sud tizimi boti</b>") && !t.contains("<matn>"));
    }

    #[test]
    fn names_with_markup_characters_are_escaped_in_company_and_bill_texts() {
        let c = crate::domain::Company { tin: "123456789".into(), name: "A & B <x> МЧЖ".into(), bills: 1, found: 2, listed: 3, years: vec![], bill_years: vec![], first_at: 0, refreshed_at: 0 };
        let t = crate::chat::company_text(&c);
        assert!(t.contains("A &amp; B &lt;x&gt; MChJ") && !t.contains("<x>"), "{t}");
        assert!(t.contains("<b>Sud roʻyxatidagi ishlar:</b> 3"));
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

mod reminders {
    use super::*;
    use crate::chat::handle_update;
    use crate::date::{secs_of_day, today};
    use crate::digest::{tick, Sent};
    use crate::prefs::Prefs;
    use std::sync::Arc;

    fn message(user: i64, text: &str) -> Value {
        json!({ "message": { "from": { "id": user }, "chat": { "id": user }, "text": text } })
    }

    fn press(user: i64, msg_id: i64, data: &str) -> Value {
        json!({ "callback_query": { "id": "1", "from": { "id": user }, "message": { "message_id": msg_id, "chat": { "id": user } }, "data": data } })
    }

    /// today at the given Uzbekistan time, as epoch seconds
    fn at(h: i64, m: i64) -> i64 {
        let n = now();
        n - secs_of_day(n) + h * 3600 + m * 60
    }

    /// the reminder messages only (the first one also pins the settings screen, which carries the «sent today» marker)
    fn reminders(sh: &Arc<crate::state::Shared>) -> Vec<crate::telegram::Sent> {
        sh.outbox.captured().into_iter().filter(|s| s.text.starts_with("📋") || s.text.starts_with("🌙")).collect()
    }

    fn pinned(sh: &Arc<crate::state::Shared>, user: i64) -> Option<(i64, String)> {
        match &sh.outbox {
            crate::telegram::Outbox::Capture(c) => c.pinned.lock().unwrap().get(&user).cloned(),
            _ => None,
        }
    }

    #[tokio::test]
    async fn settings_sends_one_screen_pins_it_and_every_button_edits_it() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, "/settings")).await;
        let sent = sh.outbox.captured();
        assert_eq!(sent.len(), 1);
        assert!(sent[0].text.contains("Eslatma sozlamalari") && sent[0].text.contains("08:00") && sent[0].text.contains("18:00") && sent[0].text.contains("hamma kompaniyalar"), "{}", sent[0].text);
        assert!(sent[0].markup.is_some());
        // pinned in the chat, and the pinned text carries the code
        let (id, text) = pinned(&sh, 4242).expect("pinned");
        assert_eq!(id, sent[0].id);
        assert_eq!(Prefs::parse(&text), Some(Prefs::default()));
        // a button: the evening moves to 20:00; the message is edited (not a new one) and the pinned text follows
        handle_update(sh.clone(), press(4242, id, "s:e:2000")).await;
        assert_eq!(sh.outbox.captured().len(), 1);
        let edited = sh.outbox.edited();
        assert!(edited[0].text.contains("🌙 <b>Kechki eslatma:</b> 20:00") && edited[0].markup.as_ref().unwrap().to_string().contains("✓ 20:00"), "{}", edited[0].text);
        assert_eq!(Prefs::parse(&pinned(&sh, 4242).unwrap().1).unwrap().evening, Some(20 * 60));
        // a company, the horizon and the morning off
        for d in [format!("s:c:{TIN}"), "s:d:14".to_string(), "s:m:off".to_string()] {
            handle_update(sh.clone(), press(4242, id, &d)).await;
        }
        let p = Prefs::parse(&pinned(&sh, 4242).unwrap().1).unwrap();
        assert_eq!((p.morning, p.evening, p.days, p.tins.clone()), (None, Some(20 * 60), 14, vec![TIN.to_string()]));
    }

    #[tokio::test]
    async fn a_label_button_and_nonsense_change_nothing_and_strangers_cannot_press() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, "/settings")).await;
        let id = sh.outbox.captured()[0].id;
        for d in ["s:noop", "s:m:0830", "s:zzz", "s:c:123"] {
            handle_update(sh.clone(), press(4242, id, d)).await;
        }
        handle_update(sh.clone(), press(777, id, "s:e:off")).await; // not on the list
        assert!(sh.outbox.edited().is_empty());
        assert_eq!(Prefs::parse(&pinned(&sh, 4242).unwrap().1), Some(Prefs::default()));
    }

    #[tokio::test]
    async fn a_restart_loses_nothing_the_settings_are_read_back_from_the_pinned_message() {
        let (sh, b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, "/settings")).await;
        let id = sh.outbox.captured()[0].id;
        handle_update(sh.clone(), press(4242, id, "s:e:1900")).await;
        handle_update(sh.clone(), press(4242, id, "s:d:30")).await;
        let (pid, ptext) = pinned(&sh, 4242).unwrap();
        // a new process: empty memory, the same chat
        let sh2 = bot(&b);
        sh2.sync().await.unwrap();
        if let crate::telegram::Outbox::Capture(c) = &sh2.outbox {
            c.pinned.lock().unwrap().insert(4242, (pid, ptext));
        }
        let p = sh2.prefs_of(4242).await;
        assert_eq!((p.evening, p.days), (Some(19 * 60), 30));
        assert_eq!(sh2.settings_msg(4242), Some(pid));
        // a person who never opened /settings has the defaults
        assert_eq!(sh2.prefs_of(999).await, Prefs::default());
    }

    #[tokio::test]
    async fn only_the_first_settings_screen_is_pinned_and_a_press_on_any_screen_updates_the_pinned_one() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), message(4242, "/settings")).await;
        let first = sh.outbox.captured()[0].id;
        assert_eq!(pinned(&sh, 4242).unwrap().0, first);
        // asking again (and again) gives a fresh screen at the bottom of the chat, but does not pin another message
        handle_update(sh.clone(), message(4242, "/settings")).await;
        handle_update(sh.clone(), message(4242, "/settings")).await;
        let captured = sh.outbox.captured();
        assert_eq!(captured.len(), 3);
        assert_eq!(pinned(&sh, 4242).unwrap().0, first, "the pinned message stays the first one");
        if let crate::telegram::Outbox::Capture(c) = &sh.outbox {
            assert_eq!(c.pins.lock().unwrap().len(), 1, "one pin only");
        }
        // a press on the newest screen changes it AND the pinned one
        let newest = captured[2].id;
        handle_update(sh.clone(), press(4242, newest, "s:d:3")).await;
        assert_eq!(Prefs::parse(&pinned(&sh, 4242).unwrap().1).unwrap().days, 3);
        assert_eq!(sh.outbox.edited().len(), 2); // the pressed one and the pinned one
        assert_eq!(sh.prefs_of(4242).await.days, 3);
    }

    #[tokio::test]
    async fn the_morning_and_evening_messages_go_at_the_persons_own_times_once_a_day() {
        let (sh, _b) = ready_bot().await;
        let mut sent = Sent::default();
        tick(&sh, at(7, 59), &mut sent).await;
        assert!(sh.outbox.captured().is_empty());
        tick(&sh, at(8, 0), &mut sent).await;
        let m = reminders(&sh);
        assert_eq!(m.len(), 1);
        assert!(m[0].text.starts_with("📋 <b>Yaqin majlislar</b>\nKeyingi 7 kun:") && m[0].text.contains(CASE), "{}", m[0].text);
        tick(&sh, at(8, 30), &mut sent).await; // already sent today
        assert_eq!(reminders(&sh).len(), 1);
        tick(&sh, at(18, 0), &mut sent).await;
        let all = reminders(&sh);
        assert_eq!(all.len(), 2);
        // the fixture has one hearing tomorrow, at 09:30
        assert!(all[1].text.starts_with("🌙 <b>Ertangi majlislar</b>\n<b>1 ta</b> · birinchisi soat <b>09:30</b>") && all[1].text.contains("2-1004-2503/8021"), "{}", all[1].text);
        tick(&sh, at(18, 20), &mut sent).await;
        assert_eq!(reminders(&sh).len(), 2);
    }

    #[tokio::test]
    async fn a_restart_or_wake_up_inside_the_hour_does_not_send_the_same_reminder_again() {
        let (sh, b) = ready_bot().await;
        let mut sent = Sent::default();
        tick(&sh, at(18, 0), &mut sent).await;
        assert_eq!(reminders(&sh).len(), 1);
        // the marker is in the pinned settings message, with the person's settings kept intact
        let (pid, ptext) = pinned(&sh, 4242).expect("the settings screen was pinned with the reminder");
        let p = Prefs::parse(&ptext).unwrap();
        assert_eq!((p.sent_e, p.sent_m), (crate::date::today(at(18, 0)), 0));
        assert_eq!((p.morning, p.evening, p.days), (Some(8 * 60), Some(18 * 60), 7));
        // the host restarts (memory gone) and wakes at 18:40: the same chat, a fresh `Sent`
        let sh2 = bot(&b);
        sh2.sync().await.unwrap();
        if let crate::telegram::Outbox::Capture(c) = &sh2.outbox {
            c.pinned.lock().unwrap().insert(4242, (pid, ptext));
        }
        let mut sent2 = Sent::default();
        tick(&sh2, at(18, 40), &mut sent2).await;
        assert_eq!(reminders(&sh2).len(), 0, "{:?}", sh2.outbox.captured());
        // the next day it goes again
        tick(&sh2, at(18, 0) + 86_400, &mut sent2).await;
        assert_eq!(reminders(&sh2).len(), 0); // (no hearing the day after tomorrow in the fixture: nothing to say, nothing sent)
        // pressing a settings button keeps the marker
        let mut sh3p = sh2.prefs_of(4242).await;
        assert_eq!(sh3p.sent_e, crate::date::today(at(18, 0)));
        sh3p.apply("d:14", &["207275139".to_string()]);
        assert_eq!(sh3p.sent_e, crate::date::today(at(18, 0)));
    }

    #[tokio::test]
    async fn a_person_can_turn_a_reminder_off_move_it_or_narrow_it_to_a_company() {
        let (sh, _b) = ready_bot().await;
        // morning off, evening at 19:00
        sh.remember_prefs(4242, Prefs { morning: None, evening: Some(19 * 60), ..Prefs::default() }, None);
        let mut sent = Sent::default();
        tick(&sh, at(8, 0), &mut sent).await;
        tick(&sh, at(18, 0), &mut sent).await;
        assert!(sh.outbox.captured().is_empty());
        tick(&sh, at(19, 5), &mut sent).await;
        assert_eq!(reminders(&sh).len(), 1);
        // only the OTHER company: nothing of the first one reaches the person (silence, not an empty message)
        let (sh2, _b2) = ready_bot().await;
        sh2.remember_prefs(4242, Prefs { tins: vec![OTHER_TIN.to_string()], ..Prefs::default() }, None);
        let mut sent2 = Sent::default();
        tick(&sh2, at(8, 0), &mut sent2).await;
        tick(&sh2, at(18, 0), &mut sent2).await;
        assert!(sh2.outbox.captured().is_empty());
        // the horizon: 3 days leaves the hearing in five days out of the morning message
        let (sh3, _b3) = ready_bot().await;
        sh3.remember_prefs(4242, Prefs { days: 3, evening: None, ..Prefs::default() }, None);
        let mut sent3 = Sent::default();
        tick(&sh3, at(8, 0), &mut sent3).await;
        let m = &sh3.outbox.captured()[0].text;
        assert!(m.contains("Keyingi 3 kun: <b>2 ta</b>") && !m.contains("2-0001-2401/5"), "{m}");
    }

    #[tokio::test]
    async fn nothing_goes_out_before_the_backup_is_read_and_two_people_have_their_own_times() {
        let b = backup();
        let mut cfg = Config::for_tests();
        cfg.allowed = vec![4242, 5151];
        let sh = bot_with(cfg, &b);
        let mut sent = Sent::default();
        tick(&sh, at(8, 0), &mut sent).await; // not synced yet
        assert!(sh.outbox.captured().is_empty());
        sh.sync().await.unwrap();
        sh.remember_prefs(5151, Prefs { morning: Some(9 * 60), evening: None, ..Prefs::default() }, None);
        tick(&sh, at(8, 0), &mut sent).await;
        assert_eq!(reminders(&sh).iter().map(|m| m.chat).collect::<Vec<_>>(), vec![4242]); // 5151 wants 09:00
        tick(&sh, at(9, 0), &mut sent).await;
        assert_eq!(reminders(&sh).iter().map(|m| m.chat).collect::<Vec<_>>(), vec![4242, 5151]);
        let _ = today(now());
    }
}

mod assets {
    use include_dir::{include_dir, Dir};
    static ASSETS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/static");

    fn texts() -> Vec<(String, String)> {
        let mut out = Vec::new();
        fn walk(d: &Dir<'static>, out: &mut Vec<(String, String)>) {
            for f in d.files() {
                let p = f.path().to_string_lossy().to_string();
                if p.ends_with(".js") || p.ends_with(".css") || p.ends_with(".html") {
                    out.push((p, String::from_utf8_lossy(f.contents()).into_owned()));
                }
            }
            for s in d.dirs() {
                walk(s, out);
            }
        }
        walk(&ASSETS, &mut out);
        out
    }

    #[test]
    fn the_mini_app_obeys_its_policy() {
        let files = texts();
        assert!(files.len() > 15);
        for (p, t) in &files {
            // the CSP forbids inline script and style, so none may be written; data is shown as text, never as markup
            assert!(!t.contains("innerHTML") && !t.contains("insertAdjacentHTML") && !t.contains("eval("), "{p}");
            assert!(!t.contains("setAttribute('style'") && !t.contains(" style=\""), "{p}");
            // nothing is loaded from another origin (the SVG namespace is a name, not a request)
            for url in t.match_indices("http").map(|(i, _)| &t[i..(i + 30).min(t.len())]) {
                assert!(url.starts_with("http://www.w3.org/2000/svg") || !url.starts_with("http://") && !url.starts_with("https://"), "{p}: {url}");
            }
        }
    }

    fn css() -> Vec<(String, String)> {
        texts().into_iter().filter(|(p, _)| p.ends_with(".css")).collect()
    }

    /// every `--name:` a stylesheet defines
    fn defined(text: &str) -> std::collections::BTreeSet<String> {
        let mut out = std::collections::BTreeSet::new();
        for (i, _) in text.match_indices("--") {
            let rest = &text[i..];
            let name: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
            if rest[name.len()..].trim_start().starts_with(':') && name.len() > 2 {
                out.insert(name);
            }
        }
        out
    }

    #[test]
    fn colours_are_written_in_the_look_and_nowhere_else() {
        // a hex colour or rgb()/hsl() belongs in css/tokens/look-navy.css (the palette); everything else reads a token
        for (p, t) in css() {
            if p.ends_with("tokens/look-navy.css") || p.ends_with("fonts.css") {
                continue;
            }
            let has_hex = t.split(|c: char| !(c.is_ascii_alphanumeric() || c == '#')).any(|w| w.len() >= 4 && w.starts_with('#') && w[1..].chars().all(|c| c.is_ascii_hexdigit()) && matches!(w.len() - 1, 3 | 4 | 6 | 8));
            assert!(!has_hex, "{p}: a hex colour outside the look");
            assert!(!t.contains("rgb(") && !t.contains("rgba(") && !t.contains("hsl("), "{p}: an rgb()/hsl() colour outside the look");
        }
    }

    #[test]
    fn every_token_a_component_reads_is_defined() {
        let mut known = std::collections::BTreeSet::new();
        for (_, t) in css() {
            known.extend(defined(&t));
        }
        // `--v` is set per element from JS (a bar's share) and `--s-*` are a status pill's local roles
        let local = |n: &str| n == "--v" || n.starts_with("--s-");
        for (p, t) in css() {
            for (i, _) in t.match_indices("var(--") {
                let name: String = t[i + 4..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
                assert!(known.contains(&name) || local(&name), "{p}: var({name}) is not defined by any token");
            }
        }
    }

    #[test]
    fn components_and_screens_read_roles_not_the_looks_raw_palette() {
        // the ramp, the signals and the brand's raw values are tier 1 of the look: a component uses the role (--surface, --text-2, --status-info-text …)
        let raw = ["var(--ramp-", "var(--signal-", "var(--canvas)", "var(--hover)", "var(--press)", "var(--focus-ring)", "var(--scrim)", "var(--brand-tile-"];
        for (p, t) in css() {
            if p.contains("/tokens/") || p.ends_with("styleguide.css") {
                continue;
            }
            for r in raw {
                assert!(!t.contains(r), "{p} reads the look's raw {r}…");
            }
        }
    }

    #[test]
    fn the_pages_load_one_stylesheet_that_imports_every_file_once() {
        let index = std::str::from_utf8(ASSETS.get_file("index.html").unwrap().contents()).unwrap();
        assert_eq!(index.matches("rel=\"stylesheet\"").count(), 1);
        assert!(index.contains("/static/css/main.css"));
        let main = std::str::from_utf8(ASSETS.get_file("css/main.css").unwrap().contents()).unwrap();
        for (p, _) in css() {
            let name = p.trim_start_matches("css/");
            if name == "main.css" || name == "styleguide.css" {
                continue;
            }
            assert_eq!(main.matches(&format!("url(\"{name}\")")).count(), 1, "{name} must be imported by main.css exactly once");
        }
        // the palette is imported before the roles that read it, and the roles before anything that uses them
        let pos = |s: &str| main.find(s).unwrap_or_else(|| panic!("{s}"));
        assert!(pos("tokens/primitives.css") < pos("tokens/look-navy.css") && pos("tokens/look-navy.css") < pos("tokens/semantic.css") && pos("tokens/semantic.css") < pos("base.css") && pos("base.css") < pos("components/surface.css"));
    }

    #[test]
    fn the_style_guide_lists_every_token() {
        let guide = std::str::from_utf8(ASSETS.get_file("js/styleguide.js").unwrap().contents()).unwrap();
        for (p, t) in css() {
            if !p.contains("/tokens/") {
                continue;
            }
            for name in defined(&t) {
                assert!(guide.contains(&format!("'{name}'")) || guide.contains(&format!("`{name}`")) || RAMP_OK(&name, guide), "{name} (in {p}) is missing from js/styleguide.js");
            }
        }
    }

    /// the neutral ramp is listed by a generator (`--ramp-${n}`), so its names are checked against the numbers written there
    #[allow(non_snake_case)]
    fn RAMP_OK(name: &str, guide: &str) -> bool {
        name.strip_prefix("--ramp-").is_some_and(|n| guide.contains("[0, 25, 50, 100, 150, 200, 300, 400, 500, 600, 700, 800, 900, 1000]") && ["0", "25", "50", "100", "150", "200", "300", "400", "500", "600", "700", "800", "900", "1000"].contains(&n))
    }

    #[test]
    fn the_component_kit_has_a_stylesheet_per_family() {
        // ui/kit/<family>.js and css/components/<family>.css: a family that has code but no styles (or the reverse) is a leftover
        let kit: Vec<String> = ASSETS.get_dir("js/ui/kit").unwrap().files().map(|f| f.path().file_stem().unwrap().to_string_lossy().to_string()).collect();
        assert!(kit.len() >= 6, "{kit:?}");
        let barrel = std::str::from_utf8(ASSETS.get_file("js/ui/components.js").unwrap().contents()).unwrap();
        for k in &kit {
            assert!(barrel.contains(&format!("./kit/{k}.js")), "{k} is not exported by ui/components.js");
        }
    }

    #[test]
    fn the_loading_screen_and_fullscreen_are_wired_without_an_external_script() {
        let get = |p: &str| String::from_utf8_lossy(ASSETS.get_file(p).unwrap().contents()).into_owned();
        let index = get("index.html");
        // the loading screen is plain markup in the page (it shows from the first byte), before the shell
        assert!(index.contains("id=\"splash\"") && index.contains("id=\"splash-msg\"") && index.find("id=\"splash\"").unwrap() < index.find("id=\"head\"").unwrap());
        assert!(!index.contains("telegram.org") && !index.contains("telegram-web-app"), "the page must not load Telegram's script: the bridge is js/core/telegram-core.js");
        let main = get("js/main.js");
        for needle in ["telegram.start()", "waitForBackup", "splashDone()", "splashFail("] {
            assert!(main.contains(needle), "main.js: {needle}");
        }
        // the shell follows the safe areas and shows the toggle only where the client can do fullscreen
        let nav = get("css/components/nav.css");
        let base = get("css/base.css");
        // the insets are the larger of the browser's and the client's safe area (never summed), plus Telegram's own button row on top; the header and the tab bar read them
        assert!(base.contains("--inset-top: calc(max(env(safe-area-inset-top), var(--tg-safe-top)) + var(--tg-content-safe-top))") && base.contains("--inset-bottom: max(env(safe-area-inset-bottom), var(--tg-safe-bottom)"));
        assert!(nav.contains("var(--inset-top)") && nav.contains("var(--inset-bottom)"), "the header and the tab bar keep clear of the insets");
        assert!(get("js/shell.js").contains("telegram.can.fullscreen"));
        // a splash and a skeleton only ever move with transform and opacity
        let splash = get("css/components/splash.css");
        for kf in splash.split("@keyframes").skip(1) {
            let body: String = kf.chars().take_while(|c| *c != '}').chain(kf.chars().skip_while(|c| *c != '}').skip(1).take_while(|c| *c != '}')).collect();
            assert!(body.contains("transform") && !body.contains("width") && !body.contains("left") && !body.contains("box-shadow"), "{body}");
        }
    }

    #[test]
    fn the_mini_app_is_latin_only() {
        for (p, t) in texts() {
            if p.ends_with("translit.js") {
                continue; // the courts answer in Cyrillic: this file turns it into Latin
            }
            assert!(!t.contains("Кирил") && !t.contains("setAlphabet") && !t.contains("prefs.js"), "{p}");
        }
    }
}

mod orders {
    use super::*;
    use crate::chat::handle_update;

    fn message(user: i64, text: &str) -> Value {
        json!({ "message": { "from": { "id": user }, "chat": { "id": user }, "text": text } })
    }
    fn press(user: i64, data: &str) -> Value {
        json!({ "callback_query": { "id": "1", "from": { "id": user }, "message": { "message_id": 9, "chat": { "id": user } }, "data": data } })
    }
    async fn with_orders() -> (std::sync::Arc<crate::state::Shared>, Backup) {
        let b = backup();
        let mut all = buckets(false);
        all.extend(orders_buckets());
        publish(&b.channel, MAIN, &b.pass, 2, &all);
        let sh = bot(&b);
        sh.sync().await.unwrap();
        (sh, b)
    }
    fn texts(sh: &std::sync::Arc<crate::state::Shared>) -> Vec<String> {
        sh.outbox.captured().into_iter().map(|m| m.text).collect()
    }

    #[tokio::test]
    async fn one_case_lists_every_instance_and_each_button_sends_its_own_pdf() {
        let (sh, _b) = with_orders().await;
        // however the number is written: spaces, lower case
        handle_update(sh.clone(), message(4242, &format!("/orders {}", CASE.replace('/', " / ").to_lowercase()))).await;
        let sent = sh.outbox.captured();
        assert_eq!(sent.len(), 1);
        let t = &sent[0].text;
        assert!(t.contains("<b>3</b> ta yuklangan") && t.contains("<b>Birinchi instansiya</b> · qanoatlantirildi") && t.contains("<b>Apellyatsiya 1</b> · rad etildi") && t.contains("<b>Apellyatsiya 2</b> · qanoatlantirildi"), "{t}");
        let kb = sent[0].markup.clone().unwrap();
        let ids: Vec<String> = kb["inline_keyboard"].as_array().unwrap().iter().map(|r| r[0]["callback_data"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, vec![format!("o:{PDF_FIRST}"), format!("o:{PDF_APPEAL}"), format!("o:{PDF_APPEAL2}")]);
        // each press sends its own file, byte for byte, with the court's file name and a caption
        for (n, id) in [PDF_APPEAL2, PDF_FIRST].iter().enumerate() {
            handle_update(sh.clone(), press(4242, &format!("o:{id}"))).await;
            let docs = sh.outbox.docs();
            assert_eq!(docs.len(), n + 1);
            let d = docs.last().unwrap();
            assert_eq!(d.0, 4242);
            assert_eq!(d.2, pdf_text(id).into_bytes());
            assert!(d.1.ends_with(".pdf") && !d.1.contains('/'), "{}", d.1);
            assert!(d.3.contains(CASE) && (d.3.contains("Apellyatsiya") || d.3.contains("Birinchi")), "{}", d.3);
        }
        assert_eq!(sh.outbox.docs()[0].1, "apellyatsiya-2.pdf");
    }

    #[tokio::test]
    async fn a_company_lists_the_orders_of_its_own_cases_newest_case_first() {
        let (sh, _b) = with_orders().await;
        handle_update(sh.clone(), message(4242, &format!("/orders {TIN}"))).await;
        let sent = sh.outbox.captured();
        let t = &sent[0].text;
        assert!(t.contains("<b>4</b> ta yuklangan"), "{t}");
        assert!(t.find("2-1004-2503/8021").unwrap() < t.find(&format!("<code>{CASE}</code>")).unwrap(), "newest case number first: {t}");
        assert!(!t.contains("2-1503-2503/5802"), "another company's order does not show: {t}");
        let kb = sent[0].markup.clone().unwrap().to_string();
        assert!(kb.contains(PDF_OTHER_CASE) && kb.contains(PDF_FIRST) && !kb.contains(PDF_OTHER_COMPANY));
        // the other company has its own
        handle_update(sh.clone(), message(4242, &format!("/orders {OTHER_TIN}"))).await;
        assert!(sh.outbox.captured()[1].markup.clone().unwrap().to_string().contains(PDF_OTHER_COMPANY));
    }

    #[tokio::test]
    async fn an_order_that_was_never_downloaded_is_listed_as_such_without_a_button() {
        let (sh, _b) = with_orders().await;
        // one saved first instance, one found appeal with no PDF: both are listed, only the saved one has a button
        handle_update(sh.clone(), message(4242, &format!("/orders {MIXED_CASE}"))).await;
        let sent = sh.outbox.captured();
        let t = &sent[0].text;
        assert!(t.contains("<b>2</b> ta qaror: 1 ta yuklangan, 1 ta yuklanmagan"), "{t}");
        assert!(t.contains("<b>Birinchi instansiya</b> · qanoatlantirildi") && t.contains("<b>Apellyatsiya</b> · rad etildi") && t.contains("⏳ <i>PDF hali yuklanmagan</i>"), "{t}");
        assert_eq!(t.matches("yuklanmagan").count(), 2, "the header and the one order: {t}");
        // the saved one opens its PDF; the other asks the app to download it
        let kb = sent[0].markup.clone().unwrap().to_string();
        assert!(kb.contains(&format!("o:{PDF_MIXED}")) && kb.contains("d:77777777-7777-7777-7777-777777777777") && !kb.contains("o:77777777") && kb.matches("callback_data").count() == 2, "{kb}");
        assert!(kb.contains("⬇️ Apellyatsiya · yuklash") && kb.contains("📄 Birinchi instansiya · "), "{kb}");
        // found, nothing downloaded at all: the list and only a «yuklash» button
        handle_update(sh.clone(), message(4242, &format!("/orders {UNSAVED_CASE}"))).await;
        let s2 = &sh.outbox.captured()[1];
        assert!(s2.text.contains("<b>1</b> ta qaror: 0 ta yuklangan, 1 ta yuklanmagan") && s2.text.contains("⏳"), "{}", s2.text);
        let k2 = s2.markup.clone().unwrap().to_string();
        assert!(k2.contains("d:88888888") && !k2.contains("o:"), "{k2}");
    }

    const UNSAVED_PDF: &str = "88888888-8888-8888-8888-888888888888";

    async fn post_json(sh: &std::sync::Arc<crate::state::Shared>, uri: &str, body: Value, init: Option<&str>) -> (StatusCode, Value) {
        let mut r = Request::builder().method("POST").uri(uri).header("content-type", "application/json");
        if let Some(i) = init {
            r = r.header("x-init-data", i);
        }
        let res = crate::http::router(sh.clone()).oneshot(r.body(Body::from(body.to_string())).unwrap()).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 10_000_000).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn the_api_lists_one_case_a_company_and_the_filtered_pages() {
        let (sh, _b) = with_orders().await;
        let me = signed(4242);
        // a case: every instance, the words in Uzbek, saved or not
        let (st, j) = get(&sh, &format!("/api/orders?case={CASE}"), Some(&me)).await;
        assert_eq!(st, StatusCode::OK);
        let rows = j["orders"]["rows"].as_array().unwrap();
        assert_eq!(rows.iter().map(|r| r["instanceWord"].as_str().unwrap()).collect::<Vec<_>>(), vec!["Birinchi instansiya", "Apellyatsiya", "Apellyatsiya"]);
        assert_eq!(rows[0]["resultWord"], "qanoatlantirildi");
        assert!(rows.iter().all(|r| r["saved"] == true && r["pdfId"].as_str().unwrap().len() == 36 && r["name"].as_str().unwrap().ends_with(".pdf")));
        // a case checked with no order says when; a never-checked one says nothing
        let (_, c) = get(&sh, &format!("/api/orders?case={CHECKED_CASE}"), Some(&me)).await;
        assert_eq!((c["orders"]["total"].as_i64(), c["orders"]["check"].as_i64()), (Some(0), Some(CHECKED_AT)));
        let (_, n) = get(&sh, "/api/orders?case=2-1004-2503/9999", Some(&me)).await;
        assert!(n["orders"]["check"].is_null());
        // a company
        let (_, co) = get(&sh, &format!("/api/orders?tin={TIN}"), Some(&me)).await;
        assert_eq!((co["orders"]["total"].as_i64(), co["orders"]["saved"].as_i64()), (Some(4), Some(4)));
        // the list: everything, newest case first, with the counts behind the chips
        let (_, all) = get(&sh, "/api/orders", Some(&me)).await;
        assert_eq!((all["orders"]["total"].as_i64(), all["orders"]["saved"].as_i64(), all["orders"]["unsaved"].as_i64()), (Some(8), Some(6), Some(2)));
        assert_eq!(all["orders"]["years"], json!([25]));
        assert_eq!(all["orders"]["courts"], json!({ "economic": 8 }));
        let chips = all["orders"]["results"].as_array().unwrap();
        assert!(chips.iter().all(|c| c["value"].as_str().unwrap().chars().all(|ch| ch.is_ascii_uppercase() || ch == '_') && !c["word"].as_str().unwrap().is_empty()));
        assert_eq!(chips.iter().map(|c| c["count"].as_i64().unwrap()).sum::<i64>(), 8 - all["orders"]["rows"].as_array().unwrap().iter().filter(|r| r["result"] == "").count() as i64 - 0, "every order with a result is counted once");
        let cases: Vec<&str> = all["orders"]["rows"].as_array().unwrap().iter().map(|r| r["caseNumber"].as_str().unwrap()).collect();
        let mut sorted = cases.clone();
        sorted.sort_by(|a, b| b.cmp(a));
        assert_eq!(cases, sorted, "newest case number first");
        // filters
        let count = |j: &Value| j["orders"]["total"].as_i64().unwrap();
        assert_eq!(count(&get(&sh, "/api/orders?saved=0", Some(&me)).await.1), 2);
        assert_eq!(count(&get(&sh, "/api/orders?saved=1", Some(&me)).await.1), 6);
        assert_eq!(count(&get(&sh, "/api/orders?result=refused", Some(&me)).await.1), 2);
        assert_eq!(count(&get(&sh, "/api/orders?q=8020", Some(&me)).await.1), 3);
        assert_eq!(count(&get(&sh, "/api/orders?q=andijon+viloyat", Some(&me)).await.1), 1, "a word of the court");
        assert_eq!(count(&get(&sh, "/api/orders?court=civil", Some(&me)).await.1), 0);
        assert_eq!(count(&get(&sh, "/api/orders?year=25", Some(&me)).await.1), 8);
        assert_eq!(count(&get(&sh, "/api/orders?year=26", Some(&me)).await.1), 0);
        // paging
        let (_, p2) = get(&sh, "/api/orders?limit=3&offset=3", Some(&me)).await;
        assert_eq!((p2["orders"]["rows"].as_array().unwrap().len(), p2["orders"]["total"].as_i64()), (3, Some(8)));
        // nobody without Telegram's launch data
        assert_eq!(get(&sh, "/api/orders", None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(get(&sh, &format!("/api/orders?case={CASE}"), Some(&signed(999))).await.0, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn botga_yuborish_sends_the_pdf_to_the_persons_own_chat_and_refuses_what_it_cannot() {
        let (sh, _b) = with_orders().await;
        let me = signed(4242);
        let (st, j) = post_json(&sh, "/api/orders/send", json!({ "pdfId": PDF_APPEAL }), Some(&me)).await;
        assert_eq!((st, j["ok"].as_bool()), (StatusCode::OK, Some(true)));
        let docs = sh.outbox.docs();
        assert_eq!(docs.len(), 1);
        assert_eq!((docs[0].0, docs[0].2.clone()), (4242, pdf_text(PDF_APPEAL).into_bytes()));
        // a malformed id, an id the backup has no file for, no launch data, a stranger
        assert_eq!(post_json(&sh, "/api/orders/send", json!({ "pdfId": "../x" }), Some(&me)).await.0, StatusCode::BAD_REQUEST);
        assert_eq!(post_json(&sh, "/api/orders/send", json!({}), Some(&me)).await.0, StatusCode::BAD_REQUEST);
        let (st, j) = post_json(&sh, "/api/orders/send", json!({ "pdfId": "99999999-9999-9999-9999-999999999999" }), Some(&me)).await;
        assert_eq!(st, StatusCode::BAD_GATEWAY);
        assert!(j["error"].as_str().unwrap().contains("zaxirada yoʻq"), "{j}");
        assert_eq!(post_json(&sh, "/api/orders/send", json!({ "pdfId": PDF_APPEAL }), None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(post_json(&sh, "/api/orders/send", json!({ "pdfId": PDF_APPEAL }), Some(&signed(999))).await.0, StatusCode::FORBIDDEN);
        assert_eq!(sh.outbox.docs().len(), 1);
    }

    #[tokio::test]
    async fn yuklash_from_the_mini_app_queues_through_the_same_link_and_says_what_happened() {
        let (sh, _b) = with_orders().await;
        let me = signed(4242);
        let ask = |id: &str| post_json(&sh, "/api/orders/download", json!({ "pdfId": id }), Some(&me));
        let (st, j) = ask(UNSAVED_PDF).await;
        assert_eq!((st, j["status"].as_str()), (StatusCode::OK, Some("not_linked")));
        assert!(j["message"].as_str().unwrap().contains("Ilova ulanmagan") && !j["message"].as_str().unwrap().contains('<'), "{j}");
        sh.link.lock().unwrap().pull(crate::state::now());
        let (_, q) = ask(UNSAVED_PDF).await;
        assert_eq!(q["status"], "queued");
        assert!(q["message"].as_str().unwrap().contains(UNSAVED_CASE) && q["message"].as_str().unwrap().contains("navbatga qoʻyildi"), "{q}");
        assert_eq!(ask(UNSAVED_PDF).await.1["status"], "joined");
        let got = sh.link.lock().unwrap().pull(crate::state::now());
        assert_eq!(crate::link::pull_json(&got)["jobs"][0]["kind"], "order");
        // an order that already has its PDF: nothing to ask; unknown and malformed ids are refused
        assert_eq!(ask(PDF_FIRST).await.1["status"], "saved");
        assert_eq!(ask("99999999-9999-9999-9999-999999999999").await.0, StatusCode::NOT_FOUND);
        assert_eq!(ask("../x").await.0, StatusCode::BAD_REQUEST);
        assert_eq!(post_json(&sh, "/api/orders/download", json!({ "pdfId": UNSAVED_PDF }), None).await.0, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn yuklash_asks_the_app_and_the_pdf_comes_to_the_person_once_the_backup_has_it() {
        let (sh, b) = with_orders().await;
        let press_d = |id: &str| press(4242, &format!("d:{id}"));
        // the app is not on: said plainly, nothing queued
        handle_update(sh.clone(), press_d(UNSAVED_PDF)).await;
        assert!(texts(&sh)[0].contains("Ilova ulanmagan"), "{:?}", texts(&sh));
        assert!(sh.link.lock().unwrap().jobs.is_empty());
        // the app is on (it asked for work a moment ago): the order is queued, a second press joins it
        sh.link.lock().unwrap().pull(crate::state::now());
        handle_update(sh.clone(), press_d(UNSAVED_PDF)).await;
        handle_update(sh.clone(), press_d(UNSAVED_PDF)).await;
        let t = texts(&sh);
        assert!(t[1].contains("navbatga qoʻyildi") && t[1].contains(UNSAVED_CASE) && t[1].contains("Birinchi instansiya"), "{}", t[1]);
        assert!(t[2].contains("allaqachon navbatda"), "{}", t[2]);
        // the next pull hands it out as an order job
        let got = sh.link.lock().unwrap().pull(crate::state::now());
        assert_eq!(got.len(), 1);
        assert_eq!(crate::link::pull_json(&got)["jobs"][0]["kind"], "order");
        assert_eq!(crate::link::pull_json(&got)["jobs"][0]["pdfId"], UNSAVED_PDF);
        // the app downloaded it and made a backup: the record now says saved, the PDF bucket exists. The person is told only after the bot has read it
        let mut all = buckets(false);
        let mut ob = orders_buckets();
        for (name, text) in ob.iter_mut() {
            if name == "orders:25" {
                *text = text.replace(&format!("\"{UNSAVED_PDF}\",\"\",5000,\"ECONOMIC\",0"), &format!("\"{UNSAVED_PDF}\",\"q.pdf\",{},\"ECONOMIC\",1774000000000", pdf_text(UNSAVED_PDF).len()));
            }
        }
        ob.push((format!("pdf:{UNSAVED_PDF}"), pdf_text(UNSAVED_PDF)));
        all.extend(ob);
        publish(&b.channel, MAIN, &b.pass, 3, &all);
        sh.link.lock().unwrap().finish(got[0].0, true, "", crate::state::now());
        assert!(sh.outbox.docs().is_empty());
        sh.sync().await.unwrap();
        crate::link::deliver(&sh).await;
        let docs = sh.outbox.docs();
        assert_eq!(docs.len(), 1, "one person pressed twice: one file");
        assert!(docs.iter().all(|d| d.0 == 4242 && d.2 == pdf_text(UNSAVED_PDF).into_bytes() && d.3.contains(UNSAVED_CASE)));
        // and the order is now a normal one: a press on the old button just sends the file
        handle_update(sh.clone(), press_d(UNSAVED_PDF)).await;
        assert_eq!(sh.outbox.docs().len(), 2);
    }

    #[tokio::test]
    async fn a_download_the_site_refused_is_told_with_the_reason_and_a_bad_or_unknown_id_is_not_queued() {
        let (sh, _b) = with_orders().await;
        sh.link.lock().unwrap().pull(crate::state::now());
        handle_update(sh.clone(), press(4242, &format!("d:{UNSAVED_PDF}"))).await;
        let got = sh.link.lock().unwrap().pull(crate::state::now());
        sh.link.lock().unwrap().finish(got[0].0, false, "Sayt qarorni faqat odam tasdiqlagandan keyin beradi: <b>qoʻlda</b>", crate::state::now());
        crate::link::deliver(&sh).await;
        let last = texts(&sh).last().unwrap().clone();
        assert!(last.contains("Qarorni yuklab boʻlmadi") && last.contains(UNSAVED_CASE) && last.contains("&lt;b&gt;qoʻlda&lt;/b&gt;"), "{last}");
        assert!(sh.outbox.docs().is_empty());
        // an id the backup does not know is never queued (the app would be asked to fetch anything), nor are malformed ones
        let before = sh.link.lock().unwrap().jobs.len();
        for bad in ["d:99999999-9999-9999-9999-999999999999", "d:../x", "d:", "d:a b"] {
            handle_update(sh.clone(), press(4242, bad)).await;
        }
        assert_eq!(sh.link.lock().unwrap().jobs.len(), before);
        assert!(texts(&sh).last().unwrap().contains("zaxirada yoʻq"));
        // a stranger cannot queue anything
        handle_update(sh.clone(), press(999, &format!("d:{UNSAVED_PDF}"))).await;
        assert_eq!(sh.link.lock().unwrap().jobs.len(), before);
    }

    #[tokio::test]
    async fn a_checked_case_with_no_order_says_so_and_a_never_checked_one_says_that() {
        let (sh, _b) = with_orders().await;
        handle_update(sh.clone(), message(4242, &format!("/orders {CHECKED_CASE}"))).await;
        handle_update(sh.clone(), message(4242, "/orders 2-1004-2503/9999")).await;
        let t = texts(&sh);
        assert!(t[0].contains("qaror eʼlon qilinmagan") && t[0].contains(&crate::chat::dmy_ms(CHECKED_AT)), "{}", t[0]);
        assert!(t[1].contains("qaror maʼlumoti yoʻq") && t[1].contains("tekshirilmagan"), "{}", t[1]);
        assert!(sh.outbox.captured().iter().all(|m| m.markup.is_none()));
    }

    #[tokio::test]
    async fn an_older_backup_with_downloaded_orders_only_still_reads() {
        // twelve-field lines, no check lines: every order is saved
        let b = backup();
        let mut all = buckets(false);
        let line = json!(["o1", CASE, "FIRST", "FULFILLED", "S", "J", "C", PDF_FIRST, "q.pdf", 10, "ECONOMIC", 1_774_000_000_000i64]).to_string();
        all.push(("orders:25".into(), format!("{line}\n")));
        all.push((format!("pdf:{PDF_FIRST}"), pdf_text(PDF_FIRST)));
        publish(&b.channel, MAIN, &b.pass, 2, &all);
        let sh = bot(&b);
        sh.sync().await.unwrap();
        handle_update(sh.clone(), message(4242, &format!("/orders {CASE}"))).await;
        let m = &sh.outbox.captured()[0];
        assert!(m.text.contains("<b>1</b> ta yuklangan") && !m.text.contains("yuklanmagan") && m.markup.is_some(), "{}", m.text);
    }

    #[tokio::test]
    async fn the_case_card_offers_its_orders_only_when_it_has_some() {
        let (sh, _b) = with_orders().await;
        handle_update(sh.clone(), message(4242, &format!("/case {CASE}"))).await;
        let m = sh.outbox.captured()[0].markup.clone().unwrap().to_string();
        assert!(m.contains("Qarorlar (3)") && m.contains(&format!("r:{CASE}")), "{m}");
        // the button opens the list
        handle_update(sh.clone(), press(4242, &format!("r:{CASE}"))).await;
        assert!(sh.outbox.captured()[1].text.contains("<b>3</b> ta yuklangan"));
        // a case with none: no button
        handle_update(sh.clone(), message(4242, "/case 2-0001-2401/5")).await;
        let last = sh.outbox.captured().last().unwrap().markup.clone().map(|m| m.to_string()).unwrap_or_default();
        assert!(!last.contains("Qarorlar"), "{last}");
    }

    #[tokio::test]
    async fn nothing_to_show_says_so_and_a_bad_id_or_a_stranger_gets_nothing() {
        let (sh, _b) = with_orders().await;
        handle_update(sh.clone(), message(4242, "/orders 2-1004-2503/9999")).await;
        handle_update(sh.clone(), message(4242, "/orders")).await;
        handle_update(sh.clone(), message(4242, "/orders 2-1004-2699/1")).await; // a year the backup has no orders for
        let t = texts(&sh);
        assert!(t[0].contains("qaror maʼlumoti yoʻq") && t[1].contains("<code>/orders 2-1004-2603/8020</code>") && t[2].contains("qaror maʼlumoti yoʻq"), "{t:?}");
        let before = sh.outbox.captured().len();
        for bad in ["o:../etc/passwd", "o:", "o:a b", "o:x", "o:99999999-9999-9999-9999-999999999999"] {
            handle_update(sh.clone(), press(4242, bad)).await;
        }
        assert!(sh.outbox.docs().is_empty());
        assert_eq!(sh.outbox.captured().len(), before + 1, "only the unknown (well-formed) id is answered"); // «bu qaror fayli zaxirada yoʻq»
        assert!(texts(&sh).last().unwrap().contains("zaxirada yoʻq"));
        // a person who is not on the list gets nothing, for a command or a button
        handle_update(sh.clone(), message(999, &format!("/orders {CASE}"))).await;
        handle_update(sh.clone(), press(999, &format!("o:{PDF_FIRST}"))).await;
        assert!(sh.outbox.docs().is_empty());
        // (a stranger's command is answered with a refusal, never with the orders; a stranger's button with nothing)
        let to_stranger: Vec<String> = sh.outbox.captured().into_iter().filter(|m| m.chat == 999).map(|m| m.text).collect();
        assert!(to_stranger.iter().all(|t| !t.contains("ta yuklangan") && !t.contains(CASE)), "{to_stranger:?}");
        assert!(sh.outbox.captured().len() <= before + 2);
    }

    #[tokio::test]
    async fn a_damaged_pdf_piece_is_never_sent() {
        let (sh, b) = with_orders().await;
        let id = piece_file_id(MAIN, &b.pass, &pdf_text(PDF_FIRST));
        b.channel.put(MAIN, &id, vec![1, 2, 3, 4, 5, 6, 7, 8]); // the channel's file changed
        handle_update(sh.clone(), press(4242, &format!("o:{PDF_FIRST}"))).await;
        assert!(sh.outbox.docs().is_empty());
        assert!(texts(&sh).last().unwrap().contains("shikastlangan"), "{:?}", texts(&sh));
    }

    #[tokio::test]
    async fn the_orders_are_in_the_help_and_a_backup_without_them_still_works() {
        let (sh, _b) = ready_bot().await; // the plain fixture: no order buckets at all
        handle_update(sh.clone(), message(4242, "/help")).await;
        assert!(texts(&sh)[0].contains("/orders"));
        handle_update(sh.clone(), message(4242, &format!("/orders {CASE}"))).await;
        assert!(texts(&sh)[1].contains("qaror maʼlumoti yoʻq"));
        handle_update(sh.clone(), message(4242, &format!("/case {CASE}"))).await;
        assert!(!sh.outbox.captured()[2].markup.clone().map(|m| m.to_string()).unwrap_or_default().contains("Qarorlar"));
    }
}

mod the_app_link {
    use super::*;
    use crate::chat::handle_update;

    fn message(user: i64, text: &str) -> Value {
        json!({ "message": { "from": { "id": user }, "chat": { "id": user }, "text": text } })
    }

    async fn call(sh: &std::sync::Arc<crate::state::Shared>, path: &str, body: &str, ts: i64, sig: Option<String>) -> (StatusCode, Value) {
        let sig = sig.unwrap_or_else(|| crate::link::sign(&Config::for_tests().token, ts, path, body.as_bytes()));
        let r = Request::builder().method("POST").uri(path).header("x-sud-ts", ts.to_string()).header("x-sud-sig", sig).body(Body::from(body.to_string())).unwrap();
        let res = crate::http::router(sh.clone()).oneshot(r).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1_000_000).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn both_doors_refuse_a_wrong_old_or_missing_signature() {
        let (sh, _b) = ready_bot().await;
        for path in ["/link/pull", "/link/synced"] {
            assert_eq!(call(&sh, path, "{}", now(), Some("00".repeat(32))).await.0, StatusCode::UNAUTHORIZED, "{path} wrong signature");
            assert_eq!(call(&sh, path, "{}", now() - 600, None).await.0, StatusCode::UNAUTHORIZED, "{path} old");
            let r = Request::builder().method("POST").uri(path).body(Body::from("{}")).unwrap();
            assert_eq!(crate::http::router(sh.clone()).oneshot(r).await.unwrap().status(), StatusCode::UNAUTHORIZED, "{path} unsigned");
        }
        assert!(sh.link.lock().unwrap().last_seen == 0, "a refused call changes nothing");
    }

    #[tokio::test]
    async fn refresh_is_asked_pulled_finished_and_told_after_the_bot_has_read_the_backup() {
        let (sh, b) = ready_bot().await;
        // the app has not been seen: the bot says so and queues nothing
        handle_update(sh.clone(), message(4242, &format!("/refresh {TIN}"))).await;
        assert!(sh.outbox.captured()[0].text.contains("Ilova ulanmagan"), "{}", sh.outbox.captured()[0].text);
        assert!(sh.link.lock().unwrap().jobs.is_empty());

        // the app asks for work (nothing yet), then a person asks
        let (st, body) = call(&sh, "/link/pull", "{}", now(), None).await;
        assert!(st == StatusCode::OK && body["jobs"].as_array().unwrap().is_empty(), "{body}");
        handle_update(sh.clone(), message(4242, "/refresh abc")).await;
        handle_update(sh.clone(), message(4242, &format!("/refresh {TIN}"))).await;
        handle_update(sh.clone(), message(4242, &format!("/refresh {TIN}"))).await;
        let sent = sh.outbox.captured();
        assert!(sent[1].text.contains("/refresh 207275139") && sent[2].text.contains("navbatga qoʻyildi") && sent[3].text.contains("allaqachon navbatda"), "{sent:?}");

        // the next pull hands the job out once
        let (_, body) = call(&sh, "/link/pull", "{}", now(), None).await;
        assert_eq!(body["jobs"].as_array().unwrap().len(), 1);
        assert_eq!(body["jobs"][0]["tin"], TIN);
        let id = body["jobs"][0]["id"].as_u64().unwrap();
        assert!(call(&sh, "/link/pull", "{}", now(), None).await.1["jobs"].as_array().unwrap().is_empty());

        // the app made a backup and reports the result: the person is NOT told yet (the bot has not read it)
        publish(&b.channel, MAIN, &b.pass, 2, &buckets(true));
        let (st, _) = call(&sh, "/link/synced", &format!(r#"{{"done":[{{"id":{id},"ok":true}}]}}"#), now(), None).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(sh.outbox.captured().len(), 4);
        // the sync loop wakes, reads, and then tells
        tokio::time::timeout(std::time::Duration::from_secs(1), sh.wake.notified()).await.expect("the ping wakes the sync loop");
        sh.sync().await.unwrap();
        crate::link::deliver(&sh).await;
        let sent = sh.outbox.captured();
        assert_eq!(sent.len(), 5, "{sent:?}");
        assert!(sent[4].text.contains("yangilandi") && sent[4].text.contains(TIN), "{}", sent[4].text);
        // told once, and the queue is empty
        crate::link::deliver(&sh).await;
        assert_eq!(sh.outbox.captured().len(), 5);
        // a company just refreshed is not asked again at once
        handle_update(sh.clone(), message(4242, &format!("/refresh {TIN}"))).await;
        assert!(sh.outbox.captured()[5].text.contains("yangilangan"), "{}", sh.outbox.captured()[5].text);
    }

    #[tokio::test]
    async fn a_failed_run_is_told_with_its_reason_and_html_is_escaped() {
        let (sh, _b) = ready_bot().await;
        call(&sh, "/link/pull", "{}", now(), None).await;
        handle_update(sh.clone(), message(4242, "/refresh 302678824")).await;
        let (_, body) = call(&sh, "/link/pull", "{}", now(), None).await;
        let id = body["jobs"][0]["id"].as_u64().unwrap();
        call(&sh, "/link/synced", &format!(r#"{{"done":[{{"id":{id},"ok":false,"note":"billing <b>rad</b> etdi"}}]}}"#), now(), None).await;
        crate::link::deliver(&sh).await;
        let last = sh.outbox.captured().last().unwrap().text.clone();
        assert!(last.contains("yangilanmadi") && last.contains("billing &lt;b&gt;rad&lt;/b&gt; etdi") && !last.contains("<b>rad"), "{last}");
        assert!(sh.outbox.captured().iter().all(|s| s.text.len() < 4096));
    }

    #[tokio::test]
    async fn a_stranger_cannot_refresh() {
        let (sh, _b) = ready_bot().await;
        call(&sh, "/link/pull", "{}", now(), None).await;
        handle_update(sh.clone(), message(999, &format!("/refresh {TIN}"))).await;
        assert!(sh.link.lock().unwrap().jobs.is_empty());
    }
}

mod debug_command {
    use super::*;
    use crate::chat::handle_update;

    #[tokio::test]
    async fn debug_sends_a_button_to_the_mini_app_with_its_diagnostics_and_is_not_in_the_menu() {
        let (sh, _b) = ready_bot().await;
        handle_update(sh.clone(), json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": "/debug" } })).await;
        let m = &sh.outbox.captured()[0];
        assert!(m.markup.clone().unwrap().to_string().contains("https://bot.example/app?debug=1"), "{:?}", m.markup);
        handle_update(sh.clone(), json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": "/help" } })).await;
        assert!(!sh.outbox.captured()[1].text.contains("/debug"));
    }
}

mod status_line {
    use super::*;
    use crate::chat::handle_update;

    #[tokio::test]
    async fn status_says_whether_the_app_is_on() {
        let (sh, _b) = ready_bot().await;
        let m = |t: &str| json!({ "message": { "from": { "id": 4242 }, "chat": { "id": 4242 }, "text": t } });
        handle_update(sh.clone(), m("/status")).await;
        assert!(sh.outbox.captured()[0].text.contains("<b>Ilova:</b> hali koʻrinmadi"), "{}", sh.outbox.captured()[0].text);
        sh.link.lock().unwrap().pull(crate::state::now());
        handle_update(sh.clone(), m("/status")).await;
        assert!(sh.outbox.captured()[1].text.contains("<b>Ilova:</b> ulangan"));
        sh.link.lock().unwrap().last_seen = crate::state::now() - 7 * 3600;
        handle_update(sh.clone(), m("/status")).await;
        assert!(sh.outbox.captured()[2].text.contains("7 soat oldin javob bergan"), "{}", sh.outbox.captured()[2].text);
    }
}

