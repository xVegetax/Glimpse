// Glimpse core: window setup, tray, global hotkey and capture commands.

mod capture;
mod mobile_share;
mod mobile_transfer;
mod ocr;
mod recording;
mod scrolling;
mod settings;
mod tray;

use tauri::{Manager, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Ensure any full-window DWM backdrop is cleared so the outer window frame
/// remains 100% transparent and only the floating glass capsules are visible.
fn prepare_floating_window(window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{clear_acrylic, clear_mica};
        let _ = clear_acrylic(window);
        let _ = clear_mica(window);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

/// UI button "Nouvelle capture".
#[tauri::command]
fn request_capture(app: tauri::AppHandle) {
    capture::start_capture(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let snip_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS);

    let result = tauri::Builder::default()
        .manage(capture::CaptureState::default())
        .manage(recording::RecordingState::default())
        .manage(mobile_share::MobileShareState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &snip_shortcut && event.state() == ShortcutState::Pressed {
                        capture::start_capture(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            request_capture,
            mobile_transfer::send_image_to_phone,
            mobile_share::start_mobile_share,
            mobile_share::stop_mobile_share,
            mobile_share::get_mobile_share_status,
            capture::get_capture_info,
            capture::get_capture_pixels,
            capture::finish_capture,
            capture::finish_freeform_capture,
            capture::capture_window_by_id,
            capture::capture_monitor_by_id,
            capture::switch_capture_monitor,
            capture::cancel_capture,
            capture::get_editor_image_info,
            capture::get_editor_image_pixels,
            capture::copy_annotated_image,
            capture::save_annotated_image,
            capture::save_multiple_images,
            ocr::recognize_image_text,
            ocr::copy_text_to_clipboard,
            recording::start_recording,
            recording::pause_recording,
            recording::stop_recording,
            recording::get_recording_status,
            recording::open_recording_folder,
            settings::get_settings,
            settings::save_settings,
            settings::pick_video_folder,
            settings::open_videos_dir,
            scrolling::start_scrolling_capture,
            scrolling::start_scrolling_window,
            scrolling::capture_scroll_step,
            scrolling::finish_scrolling_capture,
            scrolling::cancel_scrolling_capture,
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                prepare_floating_window(&window);
                let _ = window.set_always_on_top(settings::get_settings().always_on_top);
            }

            tray::create_tray(app.handle())?;

            if let Err(err) = app.global_shortcut().register(snip_shortcut) {
                eprintln!("[glimpse] could not register Ctrl+Shift+S: {err}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window hides it: the app keeps running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!());

    if let Err(err) = result {
        eprintln!("[glimpse] fatal error while running application: {err}");
        std::process::exit(1);
    }
}
