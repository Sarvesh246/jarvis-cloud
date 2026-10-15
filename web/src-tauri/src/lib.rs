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
            sign_in::begin_sign_in
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Vaelo");
}
