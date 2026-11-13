use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

pub struct TrayReady(pub bool);

pub fn summon(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("vaelo-summon", ());
    }
}

#[tauri::command]
pub fn window_ready(app: tauri::AppHandle) {
    if !std::env::args().any(|arg| arg == "--background") {
        summon(&app);
    }
}

#[tauri::command]
pub fn autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|_| "Could not read startup settings.".into())
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let result = if enabled { app.autolaunch().enable() } else { app.autolaunch().disable() };
    result.map_err(|_| "Could not change startup settings.".into())
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}};
    let show = MenuItem::with_id(app, "show", "Open Vaelo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Vaelo", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::new().menu(&menu).tooltip("Vaelo").show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => summon(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                summon(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() { builder = builder.icon(icon.clone()); }
    let ready = builder.build(app).is_ok();
    app.manage(TrayReady(ready));
    // A conflicting shortcut must not prevent the app from opening normally.
    if let Err(error) = app.global_shortcut().register("CommandOrControl+Shift+Space") {
        eprintln!("Vaelo summon shortcut unavailable: {error}");
    }
    #[cfg(any(windows, target_os = "linux"))]
    if let Err(error) = app.deep_link().register_all() { eprintln!("Vaelo link registration unavailable: {error}"); }
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        if event.urls().iter().any(|url| url.scheme() == "vaelo") { summon(&handle); }
    });
    Ok(())
}
