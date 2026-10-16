mod sign_in;

use std::sync::{atomic::AtomicBool, Mutex};
use tauri::Manager;

const CLOUD: &str = "https://vaelochat.vercel.app";
const CREDENTIAL_SERVICE: &str = "app.vaelo.desktop";

#[derive(Default)]
struct Session {
    token: Mutex<Option<String>>,
    signing_in: AtomicBool,
    cancel_sign_in: tokio::sync::Notify,
}

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, "session")
        .map_err(|_| "Vaelo could not open the system credential store.".into())
}

#[tauri::command]
fn session_token(state: tauri::State<'_, Session>) -> Result<Option<String>, String> {
    let mut token = state.token.lock().map_err(|_| "Please restart Vaelo.")?;
    if token.is_none() {
        match credential()?.get_password() {
            Ok(saved) => *token = Some(saved),
            Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Unlock your system credential store, then try again.".into()),
        }
    }
    Ok(token.clone())
}

#[tauri::command]
fn clear_session(state: tauri::State<'_, Session>) -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(_) => return Err("Vaelo could not remove its saved session. Unlock the system credential store and try again.".into()),
    }
    *state.token.lock().map_err(|_| "Please restart Vaelo.")? = None;
    Ok(())
}

#[tauri::command]
fn cancel_sign_in(state: tauri::State<'_, Session>) {
    state.cancel_sign_in.notify_waiters();
}

#[tauri::command]
fn store_notification(title: String, body: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::{
            core::HSTRING,
            Data::Xml::Dom::XmlDocument,
            UI::Notifications::{ToastNotification, ToastNotificationManager},
        };
        let escape = |text: String| {
            text.chars()
                .take(500)
                .collect::<String>()
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        };
        let xml = format!("<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>", escape(title), escape(body));
        let show = || -> windows::core::Result<()> {
            let document = XmlDocument::new()?;
            document.LoadXml(&HSTRING::from(xml))?;
            // With MSIX identity, Windows uses the current package's AUMID.
            let notifier = ToastNotificationManager::CreateToastNotifier()?;
            notifier.Show(&ToastNotification::CreateToastNotification(&document)?)
        };
        show().map_err(|_| "Vaelo could not show the notification.".into())
    }
    #[cfg(not(windows))]
    {
        let _ = (title, body);
        Err("Store notifications are available on Windows.".into())
    }
}

fn rgb(hex: &str) -> Option<u32> {
    let hex = hex.strip_prefix('#').filter(|h| h.len() == 6)?;
    let value = u32::from_str_radix(hex, 16).ok()?;
    // COLORREF is 0x00BBGGRR.
    Some(((value & 0xff) << 16) | (value & 0xff00) | (value >> 16))
}

/* Paints the native Windows title bar in Vaelo's own paper and ink, so the
   bar reads as part of the app while keeping Snap Layouts, resizing and the
   system buttons. Windows 10 ignores these attributes and keeps its bar. */
#[tauri::command]
fn title_bar(window: tauri::WebviewWindow, dark: bool, caption: String, text: String) -> Result<(), String> {
    let (caption, text) = rgb(&caption).zip(rgb(&text)).ok_or("Invalid title bar color.")?;
    let _ = window.set_theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }));
    #[cfg(windows)]
    {
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        };
        let hwnd = window.hwnd().map_err(|_| "Vaelo could not reach its window.")?;
        for (attribute, color) in [(DWMWA_CAPTION_COLOR, caption), (DWMWA_BORDER_COLOR, caption), (DWMWA_TEXT_COLOR, text)] {
            unsafe {
                let _ = DwmSetWindowAttribute(hwnd, attribute, (&color as *const u32).cast(), 4);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (caption, text);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn title_bar_colors_become_colorref_and_reject_anything_else() {
        assert_eq!(super::rgb("#16110f"), Some(0x000f1116));
        assert_eq!(super::rgb("#f7f2ea"), Some(0x00eaf2f7));
        assert_eq!(super::rgb("16110f"), None);
        assert_eq!(super::rgb("#fff"), None);
        assert_eq!(super::rgb("#zzzzzz"), None);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Session::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            session_token,
            clear_session,
            cancel_sign_in,
            store_notification,
            title_bar,
            sign_in::begin_sign_in
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Vaelo");
}
