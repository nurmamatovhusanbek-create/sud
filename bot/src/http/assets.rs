//! The Mini App's files (HTML, CSS, ES modules, fonts) compiled into the binary, with a strict policy: everything same-origin, no inline script or
//! style, and only Telegram may frame it.

use axum::{
    extract::Path,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use include_dir::{include_dir, Dir};

static ASSETS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/static");

const POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org";

fn secure(mut r: Response) -> Response {
    let h = r.headers_mut();
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(POLICY));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    r
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "woff2" => "font/woff2",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn asset(path: &str) -> Response {
    // a path inside static/ only: no `..`, no empty parts
    if path.split('/').any(|p| p == ".." || p.is_empty()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match ASSETS.get_file(path) {
        Some(f) => {
            let cache = if path.ends_with(".woff2") { "public, max-age=31536000, immutable" } else { "no-cache" };
            secure(([(header::CONTENT_TYPE, mime(path)), (header::CACHE_CONTROL, cache)], f.contents()).into_response())
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub async fn app_page() -> Response {
    asset("index.html")
}

pub async fn static_file(Path(path): Path<String>) -> Response {
    asset(&path)
}
