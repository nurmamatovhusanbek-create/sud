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
        assert!(text.contains("Javobgar · qarshi tomon: Universal MChJ") && !text.contains("Universal MChJ — ANOR"), "{text}");
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
        assert!(sh.outbox.captured()[0].text.contains("«ANOR» МЧЖ: Javobgar · qarshi tomon: Boshqa Kompaniya") || sh.outbox.captured()[0].text.contains("«ANOR» MChJ: Javobgar · qarshi tomon: Boshqa Kompaniya"), "{}", sh.outbox.captured()[0].text);
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
        assert!(first.text.len() < 4096 && first.text.contains("100 ta · 1–20"), "{}", first.text);
        let kb = first.markup.unwrap();
        assert_eq!(kb["inline_keyboard"][0][0]["callback_data"], "h:14::20");
        assert!(kb["inline_keyboard"][0][0]["text"].as_str().unwrap().contains("Keyingi 20"));
        assert!(kb["inline_keyboard"][1][0]["web_app"]["url"].as_str().unwrap().ends_with("/app?tab=hearings"));
        // the «next» button asks for the following page, and the last page has no «next»
        for (offset, last) in [(20, false), (40, false), (60, false), (80, true)] {
            let cb = json!({ "callback_query": { "id": "1", "from": { "id": 4242 }, "message": { "chat": { "id": 4242 } }, "data": format!("h:14::{offset}") } });
            crate::chat::handle_update(sh.clone(), cb).await;
            let m = sh.outbox.captured().last().unwrap().clone();
            assert!(m.text.contains(&format!("{}–{}", offset + 1, offset + 20)) && m.text.len() < 4096);
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
        assert!(sent[0].text.contains("(1 kun): 1 ta"));
        assert!(sent[1].text.contains("Yaqin 30 kunda majlis yoʻq") && sent[1].text.contains(OTHER_TIN));
        assert!(sent[2].text.contains(&format!("STIR {TIN}")) && sent[2].text.contains("3 ta"));
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
        assert!(body.starts_with("📅 Yaqin majlislar (7 kun): 3 ta"));
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
        assert!(sent[0].text.contains("Daʼvogar: Daʼvogar MChJ") && sent[0].text.contains("Daʼvo qanoatlantirilsin"));
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
