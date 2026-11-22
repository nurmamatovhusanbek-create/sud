//! A per-person sliding-window limiter: a Mini App screen makes a handful of calls, a loop or a stolen session would make thousands (each can mean a
//! download from Telegram). In memory, per process.

use std::{collections::{HashMap, VecDeque}, sync::Mutex, time::{Duration, Instant}};

pub struct RateLimiter {
    per_minute: usize,
    hits: Mutex<HashMap<i64, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new(per_minute: usize) -> RateLimiter {
        RateLimiter { per_minute, hits: Mutex::new(HashMap::new()) }
    }

    /// true = allowed (and counted)
    pub fn allow(&self, user: i64) -> bool {
        self.allow_at(user, Instant::now())
    }

    pub fn allow_at(&self, user: i64, now: Instant) -> bool {
        if self.per_minute == 0 {
            return true;
        }
        let mut all = self.hits.lock().unwrap();
        let q = all.entry(user).or_default();
        while q.front().map(|t| now.duration_since(*t) >= Duration::from_secs(60)).unwrap_or(false) {
            q.pop_front();
        }
        if q.len() >= self.per_minute {
            return false;
        }
        q.push_back(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_person_gets_a_budget_per_minute_and_it_comes_back() {
        let rl = RateLimiter::new(3);
        let t0 = Instant::now();
        assert!(rl.allow_at(1, t0) && rl.allow_at(1, t0) && rl.allow_at(1, t0));
        assert!(!rl.allow_at(1, t0), "the fourth call in the minute is refused");
        assert!(rl.allow_at(2, t0), "another person has their own budget");
        assert!(rl.allow_at(1, t0 + Duration::from_secs(61)), "a minute later the budget is back");
    }

    #[test]
    fn zero_means_no_limit() {
        let rl = RateLimiter::new(0);
        for _ in 0..1000 {
            assert!(rl.allow(7));
        }
    }
}
