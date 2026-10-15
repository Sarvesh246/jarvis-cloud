use crate::{credential, Session, CLOUD};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{sync::atomic::Ordering, time::Duration};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};

fn random_proof() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn callback_code(request: &str, port: u16, expected_state: &str) -> Option<String> {
    let mut lines = request.lines();
    let first = lines.next()?;
    let mut parts = first.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    if !target.starts_with("/callback?") {
        return None;
    }
    let host = format!("127.0.0.1:{port}");
    if !lines.any(|line| {
        line.split_once(':')
            .is_some_and(|(key, value)| key.eq_ignore_ascii_case("host") && value.trim() == host)
    }) {
        return None;
    }
    let url = url::Url::parse(&format!("http://{host}{target}")).ok()?;
    let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    if query.get("state")? != expected_state {
        return None;
    }
    let code = query.get("code")?;
    if code.len() != 43
        || !code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return None;
    }
    Some(code.clone())
}

#[derive(Deserialize)]
struct Exchange {
    token: String,
}

async fn sign_in(app: &tauri::AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| {
            "Vaelo could not open the sign-in callback. Check your firewall and try again."
        })?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not start sign-in.")?
        .port();
    let verifier = random_proof();
    let state = random_proof();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = url::Url::parse(CLOUD).map_err(|_| "Invalid sign-in address.")?;
    url.query_pairs_mut()
        .append_pair("desktop", "1")
        .append_pair("port", &port.to_string())
        .append_pair("state", &state)
        .append_pair("challenge", &challenge);
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Could not open your browser. Try again.")?;
    let code = timeout(Duration::from_secs(300), async {
        loop {
            let (mut socket, _) = listener.accept().await.map_err(|_| "Could not receive sign-in.")?;
            let mut request = Vec::new();
            let read = timeout(Duration::from_secs(3), async {
                let mut chunk = [0u8; 1024];
                while request.len() < 8192 {
                    let n = socket.read(&mut chunk).await?;
                    if n == 0 { break; }
                    request.extend_from_slice(&chunk[..n]);
                    if request.windows(4).any(|w| w == b"\r\n\r\n") { break; }
                }
                Ok::<_, std::io::Error>(())
            }).await;
            let code = if matches!(read, Ok(Ok(()))) {
                callback_code(&String::from_utf8_lossy(&request), port, &state)
            } else { None };
            let body = if code.is_some() { "Sign-in received. Return to Vaelo to finish. You can close this tab." }
                else { "This sign-in return could not be verified. Return to Vaelo and try again." };
            let status = if code.is_some() { "200 OK" } else { "400 Bad Request" };
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = timeout(Duration::from_secs(2), socket.write_all(response.as_bytes())).await;
            if let Some(code) = code { break Ok::<String, String>(code); }
        }
    }).await.map_err(|_| "Sign-in timed out. Click Continue with Google to try again.")??;
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not connect to Vaelo.")?
        .post(format!("{CLOUD}/api/desktop-auth"))
        .json(&serde_json::json!({ "action": "exchange", "code": code, "verifier": verifier }))
        .send()
        .await
        .map_err(|_| "Could not reach Vaelo. Check your connection and try signing in again.")?;
    if !response.status().is_success() {
        return Err("Sign-in expired or was refused. Please try again.".into());
    }
    let exchange: Exchange = response
        .json()
        .await
        .map_err(|_| "Vaelo returned an invalid sign-in response.")?;
    if exchange.token.len() > 8192 {
        return Err("Vaelo returned an invalid sign-in response.".into());
    }
    credential()?
        .set_password(&exchange.token)
        .map_err(|_| "Unlock your system credential store so Vaelo can save your sign-in.")?;
    *app.state::<Session>()
        .token
        .lock()
        .map_err(|_| "Please restart Vaelo.")? = Some(exchange.token);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn begin_sign_in(app: tauri::AppHandle) -> Result<(), String> {
    if app
        .state::<Session>()
        .signing_in
        .swap(true, Ordering::SeqCst)
    {
        return Err(
            "Sign-in is already open in your browser. Finish there, or try again in five minutes."
                .into(),
        );
    }
    let result = sign_in(&app).await;
    app.state::<Session>()
        .signing_in
        .store(false, Ordering::SeqCst);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn loopback_requires_exact_host_path_state_and_code() {
        let code = "a".repeat(43);
        let request = format!(
            "GET /callback?code={code}&state=expected HTTP/1.1\r\nHost: 127.0.0.1:45000\r\n\r\n"
        );
        assert_eq!(callback_code(&request, 45000, "expected"), Some(code));
        assert_eq!(callback_code(&request, 45000, "wrong"), None);
        assert_eq!(callback_code(&request, 45001, "expected"), None);
        assert_eq!(
            callback_code(&request.replace("GET", "POST"), 45000, "expected"),
            None
        );
        assert_eq!(
            callback_code(&request.replace("/callback", "/other"), 45000, "expected"),
            None
        );
    }
    #[test]
    fn proof_has_required_pkce_entropy_and_encoding() {
        let a = random_proof();
        assert_eq!(a.len(), 43);
        assert_ne!(a, random_proof());
        assert_eq!(URL_SAFE_NO_PAD.decode(a).unwrap().len(), 32);
    }
}
