mod double_shift;

use double_shift::DoubleTapDetector;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Synthesize ⌘C into the frontmost app (macOS only).
#[cfg(target_os = "macos")]
fn synthesize_cmd_c() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    let Ok(src) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
        return;
    };
    const KEY_C: u16 = 8;
    if let Ok(down) = CGEvent::new_keyboard_event(src.clone(), KEY_C, true) {
        down.set_flags(CGEventFlags::CGEventFlagCommand);
        down.post(CGEventTapLocation::HID);
    }
    if let Ok(up) = CGEvent::new_keyboard_event(src, KEY_C, false) {
        up.set_flags(CGEventFlags::CGEventFlagCommand);
        up.post(CGEventTapLocation::HID);
    }
}

/// Capture the frontmost app's current text selection via a synthetic ⌘C,
/// restoring the user's clipboard afterwards. Runs only at the moment the
/// double-Shift shortcut shows the panel; contents are never logged.
fn capture_frontmost_selection(app: &AppHandle) -> Option<String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
    #[cfg(target_os = "macos")]
    {
        let clipboard = app.clipboard();
        let before = clipboard.read_text().unwrap_or_default();
        synthesize_cmd_c();
        std::thread::sleep(std::time::Duration::from_millis(150));
        let after = clipboard.read_text().unwrap_or_default();
        let _ = clipboard.write_text(before.clone());
        (!after.is_empty() && after != before).then_some(after)
    }
}

#[tauri::command]
fn is_accessibility_trusted() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_client::accessibility::application_is_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn prompt_accessibility() {
    #[cfg(target_os = "macos")]
    macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
}

/// Moves a corrupt data file aside so the app can start fresh without
/// silently destroying data. Timestamped so earlier backups are never
/// overwritten.
#[tauri::command]
fn backup_corrupt_store(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = dir.join("stash.json");
    if file.exists() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        std::fs::rename(&file, dir.join(format!("stash.{ts}.json.bak")))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct InboxEntry {
    text: String,
    section: Option<String>,
}

/// Reads and deletes the MCP sidecar inbox. The MCP server never writes to
/// stash.json (the running app owns it); it drops captures here instead.
#[tauri::command]
fn drain_mcp_inbox(app: AppHandle) -> Result<Vec<InboxEntry>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let inbox = dir.join("mcp-inbox");
    if !inbox.is_dir() {
        return Ok(vec![]);
    }
    // One file per entry: each is deleted only after a successful parse, so
    // a write landing mid-drain is simply picked up next tick. Malformed
    // files are renamed aside (never silently deleted).
    let mut entries = Vec::new();
    for e in std::fs::read_dir(&inbox).map_err(|e| e.to_string())? {
        let path = e.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let parsed = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|v| {
                let text = v.get("text")?.as_str()?.trim().to_string();
                let created = v.get("createdAt").and_then(|c| c.as_f64()).unwrap_or(0.0);
                (!text.is_empty()).then(|| {
                    (
                        created,
                        InboxEntry {
                            text,
                            section: v
                                .get("section")
                                .and_then(|s| s.as_str())
                                .map(str::to_string),
                        },
                    )
                })
            });
        match parsed {
            Some(entry) => {
                if std::fs::remove_file(&path).is_ok() {
                    entries.push(entry);
                }
            }
            None => {
                let _ = std::fs::rename(&path, path.with_extension("bad"));
            }
        }
    }
    // Oldest first, so merged captures keep chronological order.
    entries.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(entries.into_iter().map(|(_, e)| e).collect())
}

fn show_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("panel-shown", ());
}

fn toggle_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    // Focus-aware toggle (AC-1): a visible-but-unfocused panel gets focused,
    // not hidden — hiding is only for the panel the user is actively in.
    if visible && focused {
        let _ = window.hide();
    } else {
        // Grab the frontmost app's selection before we steal focus.
        let selection = if visible { None } else { capture_frontmost_selection(app) };
        show_panel(app);
        if let Some(text) = selection {
            let _ = app.emit("selection-captured", text);
        }
    }
}

fn spawn_double_shift_listener(app: AppHandle) {
    // Poll physical key state instead of an event tap: taps can report a
    // Shift release as a second "press" (phantom double-tap that hid the
    // panel on shift-click). Polling reads the real key state, so a press
    // transition can never be confused with a release.
    std::thread::spawn(move || {
        use device_query::{DeviceQuery, DeviceState, Keycode};
        let device = DeviceState::new();
        let mut detector = DoubleTapDetector::new();
        let start = std::time::Instant::now();
        let mut prev: Vec<Keycode> = Vec::new();
        loop {
            let keys = device.get_keys();
            let now_ms = start.elapsed().as_millis() as u64;
            for key in &keys {
                if !prev.contains(key) {
                    let is_shift = matches!(key, Keycode::LShift | Keycode::RShift);
                    if detector.on_key_press(is_shift, now_ms) {
                        toggle_panel(&app);
                    }
                }
            }
            prev = keys;
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            spawn_double_shift_listener(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the panel hides it; the app keeps running for ⇧⇧.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            is_accessibility_trusted,
            prompt_accessibility,
            backup_corrupt_store,
            drain_mcp_inbox
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Dock-icon click re-shows the panel — the recovery path that
            // works even before Accessibility permission is granted (AC-9).
            if let tauri::RunEvent::Reopen { .. } = event {
                show_panel(app_handle);
            }
        });
}
