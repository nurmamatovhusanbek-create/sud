//! Calendar dates as `yyyymmdd` numbers in Uzbekistan time (UTC+5, no summer time). The backup carries a hearing's date as such a number, so
//! «from today on», «in the next 7 days» and sorting are plain integer comparisons.

const UZ_OFFSET: i64 = 5 * 3600;

/// days since 1970-01-01 → (year, month, day)  (Howard Hinnant's civil-from-days)
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// (year, month, day) → days since 1970-01-01
fn days_from(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn key_of(y: i64, m: i64, d: i64) -> u32 {
    (y * 10_000 + m * 100 + d) as u32
}

/// today (Uzbekistan) as yyyymmdd, from epoch seconds
pub fn today(now_secs: i64) -> u32 {
    let (y, m, d) = civil((now_secs + UZ_OFFSET).div_euclid(86_400));
    key_of(y, m, d)
}

/// seconds into the day in Uzbekistan
pub fn secs_of_day(now_secs: i64) -> i64 {
    (now_secs + UZ_OFFSET).rem_euclid(86_400)
}

/// the date `n` days after `key`
pub fn add_days(key: u32, n: i64) -> u32 {
    let (y, m, d) = (i64::from(key / 10_000), i64::from(key / 100 % 100), i64::from(key % 100));
    let (y2, m2, d2) = civil(days_from(y, m, d) + n);
    key_of(y2, m2, d2)
}

/// `20301215` → `15.12.2030`
pub fn dmy(key: u32) -> String {
    format!("{:02}.{:02}.{}", key % 100, key / 100 % 100, key / 10_000)
}

/// the weekday of a date, in Uzbek (`20261124` → «seshanba»)
pub fn weekday(key: u32) -> &'static str {
    let (y, m, d) = (i64::from(key / 10_000), i64::from(key / 100 % 100), i64::from(key % 100));
    // 1970-01-01 was a Thursday
    match (days_from(y, m, d) + 3).rem_euclid(7) {
        0 => "dushanba",
        1 => "seshanba",
        2 => "chorshanba",
        3 => "payshanba",
        4 => "juma",
        5 => "shanba",
        _ => "yakshanba",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_weekday_is_right_for_known_dates() {
        assert_eq!(weekday(20_261_124), "seshanba");
        assert_eq!(weekday(20_260_101), "payshanba");
        assert_eq!(weekday(20_240_229), "payshanba");
        assert_eq!(weekday(20_261_129), "yakshanba");
    }

    #[test]
    fn today_follows_uzbekistan_time() {
        // 2026-11-22 18:59 UTC is still the 22nd in Uzbekistan (23:59); a minute later it is the 23rd
        assert_eq!(today(1_795_373_940), 20_261_122);
        assert_eq!(today(1_795_373_940 + 60), 20_261_123);
    }

    #[test]
    fn days_are_added_across_months_years_and_leap_days() {
        assert_eq!(add_days(20_261_130, 1), 20_261_201);
        assert_eq!(add_days(20_261_231, 1), 20_270_101);
        assert_eq!(add_days(20_280_228, 1), 20_280_229);
        assert_eq!(add_days(20_270_228, 1), 20_270_301);
        assert_eq!(add_days(20_261_122, 7), 20_261_129);
        assert_eq!(add_days(20_261_122, 0), 20_261_122);
    }

    #[test]
    fn dates_are_shown_as_the_courts_write_them() {
        assert_eq!(dmy(20_301_205), "05.12.2030");
        assert_eq!(secs_of_day(1_795_373_940 + 60), 0);
    }
}
