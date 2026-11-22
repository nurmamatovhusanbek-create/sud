//! Telegram Mini App authentication: the page sends `initData`; it is signed by Telegram with a key derived from the bot token
//! (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). Only listed users get in.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// the user id when the data is genuine, fresh (not older than `max_age` seconds) and signed with this bot's token
pub fn validate_init_data(init: &str, token: &str, now: i64, max_age: i64) -> Option<i64> {
    let mut hash = None;
    let mut auth_date = 0i64;
    let mut user = None;
    let mut pairs: Vec<(String, String)> = Vec::new();
    for (k, v) in form_urlencoded::parse(init.as_bytes()) {
        match k.as_ref() {
            "hash" => hash = Some(v.to_string()),
            _ => {
                if k == "auth_date" {
                    auth_date = v.parse().unwrap_or(0);
                }
                if k == "user" {
                    user = Some(v.to_string());
                }
                pairs.push((k.to_string(), v.to_string()));
            }
        }
    }
    let hash = hex::decode(hash?).ok()?;
    pairs.sort();
    let check = pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");
    let mut secret = HmacSha256::new_from_slice(b"WebAppData").ok()?;
    secret.update(token.as_bytes());
    let key = secret.finalize().into_bytes();
    let mut mac = HmacSha256::new_from_slice(&key).ok()?;
    mac.update(check.as_bytes());
    mac.verify_slice(&hash).ok()?;
    if auth_date <= 0 || now - auth_date > max_age || auth_date - now > 300 {
        return None;
    }
    let u: serde_json::Value = serde_json::from_str(&user?).ok()?;
    u["id"].as_i64()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(token: &str, fields: &[(&str, &str)]) -> String {
        let mut sorted: Vec<_> = fields.to_vec();
        sorted.sort();
        let check = sorted.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");
        let mut s = HmacSha256::new_from_slice(b"WebAppData").unwrap();
        s.update(token.as_bytes());
        let key = s.finalize().into_bytes();
        let mut m = HmacSha256::new_from_slice(&key).unwrap();
        m.update(check.as_bytes());
        let hash = hex::encode(m.finalize().into_bytes());
        let mut ser = form_urlencoded::Serializer::new(String::new());
        for (k, v) in fields {
            ser.append_pair(k, v);
        }
        ser.append_pair("hash", &hash);
        ser.finish()
    }

    const TOKEN: &str = "123456789:AAFakeFakeFakeFakeFakeFakeFakeFake_x1Yz";
    const USER: &str = "{\"id\":4242,\"first_name\":\"A\"}";

    #[test]
    fn genuine_fresh_data_gives_the_user_id() {
        let init = sign(TOKEN, &[("auth_date", "1000"), ("query_id", "AAH"), ("user", USER)]);
        assert_eq!(validate_init_data(&init, TOKEN, 1100, 86400), Some(4242));
    }

    #[test]
    fn forged_stale_or_foreign_data_is_refused() {
        let init = sign(TOKEN, &[("auth_date", "1000"), ("user", USER)]);
        assert_eq!(validate_init_data(&init, "999999999:AAOtherOtherOtherOtherOtherOther12", 1100, 86400), None); // another bot's token
        assert_eq!(validate_init_data(&init, TOKEN, 1000 + 86401, 86400), None); // too old
        assert_eq!(validate_init_data(&init.replace("4242", "1"), TOKEN, 1100, 86400), None); // user changed
        assert_eq!(validate_init_data("auth_date=1&user=x", TOKEN, 100, 86400), None); // no hash
        assert_eq!(validate_init_data("", TOKEN, 100, 86400), None);
    }
}
