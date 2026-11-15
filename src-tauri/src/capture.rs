// capture.rs — screen capture flow: grab monitor under cursor + open windows
// + all connected monitors, show selection overlay (Rect / Freeform / Window
// picker / Monitor picker), copy result to clipboard, and feed the editor.

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder,
};
use xcap::image::{DynamicImage, RgbaImage, imageops};
use xcap::{Monitor, Window};

pub const OVERLAY_LABEL: &str = "overlay";
const MAIN_LABEL: &str = "main";

const GWL_EXSTYLE: i32 = -20;
const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const WS_EX_APPWINDOW: u32 = 0x0004_0000;
const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
const DWMWA_CLOAKED: u32 = 14;
const SW_RESTORE: i32 = 9;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct WinRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct WinPoint {
    x: i32,
    y: i32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct WindowPlacement {
    length: u32,
    flags: u32,
    show_cmd: u32,
    pt_min_position: WinPoint,
    pt_max_position: WinPoint,
    rc_normal_position: WinRect,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn EnumWindows(
        lp_enum_func: unsafe extern "system" fn(isize, isize) -> i32,
        l_param: isize,
    ) -> i32;
    fn IsWindow(hwnd: isize) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn IsIconic(hwnd: isize) -> i32;
    fn GetWindowLongW(hwnd: isize, index: i32) -> i32;
    fn GetClassNameW(hwnd: isize, lp_class_name: *mut u16, max_count: i32) -> i32;
    fn GetWindowTextLengthW(hwnd: isize) -> i32;
    fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, max_count: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
    fn GetWindowPlacement(hwnd: isize, lpwndpl: *mut WindowPlacement) -> i32;
    fn GetWindowRect(hwnd: isize, lp_rect: *mut WinRect) -> i32;
    fn ShowWindow(hwnd: isize, cmd_show: i32) -> i32;
    fn SetForegroundWindow(hwnd: isize) -> i32;
    fn BringWindowToTop(hwnd: isize) -> i32;
}

#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmGetWindowAttribute(
        hwnd: isize,
        dw_attribute: u32,
        pv_attribute: *mut c_void,
        cb_attribute: u32,
    ) -> i32;
}

/// Open application window (for both hover detection and the clickable window picker list).
#[derive(Clone, Serialize)]
pub struct WindowRect {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub on_current_monitor: bool,
    pub is_minimized: bool,
}

/// Connected monitor summary for the multi-screen picker.
#[derive(Clone, Serialize)]
pub struct MonitorSummary {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub is_current: bool,
}

/// Holds the full-monitor screenshot, the visible windows, the monitors list,
/// and the last cropped/cutout capture for the annotation editor.
#[derive(Default)]
pub struct CaptureState {
    pending: Mutex<Option<RgbaImage>>,
    pending_windows: Mutex<Vec<WindowRect>>,
    pending_monitors: Mutex<Vec<MonitorSummary>>,
    captured: Mutex<Option<RgbaImage>>,
}

impl CaptureState {
    pub fn cloned_captured(&self) -> Option<RgbaImage> {
        self.captured.lock().ok().and_then(|c| c.clone())
    }
}

#[derive(Serialize)]
pub struct CaptureInfo {
    width: u32,
    height: u32,
    windows: Vec<WindowRect>,
    monitors: Vec<MonitorSummary>,
}

/// Selection rectangle in screenshot pixel coordinates.
#[derive(Deserialize)]
pub struct Region {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

/// Entry point used by the hotkey, the tray menu and the UI button.
pub fn start_capture(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run_capture(&app, None) {
            eprintln!("[glimpse] capture failed: {err}");
            let _ = app.emit_to(MAIN_LABEL, "capture-error", err);
        }
    });
}

fn run_capture(app: &AppHandle, target_monitor_id: Option<u32>) -> Result<(), String> {
    // If switching monitors while overlay is already open, close existing overlay first.
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        if target_monitor_id.is_none() {
            return Ok(());
        }
        close_overlay(app);
        std::thread::sleep(Duration::from_millis(80));
    }

    // Hide our own window so it does not appear in the screenshot.
    let main = app.get_webview_window(MAIN_LABEL);
    let main_was_visible = main
        .as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if main_was_visible {
        if let Some(w) = &main {
            let _ = w.hide();
        }
        std::thread::sleep(Duration::from_millis(180));
    }

    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let (cx, cy) = (cursor.x as i32, cursor.y as i32);

    let all_monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = if let Some(tid) = target_monitor_id {
        all_monitors
            .iter()
            .find(|m| m.id().unwrap_or(0) == tid)
            .cloned()
            .ok_or("target monitor not found")?
    } else {
        Monitor::from_point(cx, cy).map_err(|e| e.to_string())?
    };

    let current_mon_id = monitor.id().unwrap_or(0);
    let mon_x = monitor.x().unwrap_or(0);
    let mon_y = monitor.y().unwrap_or(0);
    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    let mon_w = image.width();
    let mon_h = image.height();

    // Build connected monitors summary list
    let monitors: Vec<MonitorSummary> = all_monitors
        .iter()
        .enumerate()
        .map(|(idx, m)| {
            let id = m.id().unwrap_or(idx as u32);
            let is_primary = m.is_primary().unwrap_or(false);
            let label = if is_primary {
                format!("Écran {} (Principal)", idx + 1)
            } else {
                format!("Écran {}", idx + 1)
            };
            MonitorSummary {
                id,
                name: label,
                width: m.width().unwrap_or(mon_w),
                height: m.height().unwrap_or(mon_h),
                is_primary,
                is_current: id == current_mon_id,
            }
        })
        .collect();

    // Collect open application windows (ordered front-to-back).
    let windows = collect_open_windows(mon_x, mon_y, mon_w, mon_h);

    let state = app.state::<CaptureState>();
    if let Ok(mut pending) = state.pending.lock() {
        *pending = Some(image);
    }
    if let Ok(mut pw) = state.pending_windows.lock() {
        *pw = windows;
    }
    if let Ok(mut pm) = state.pending_monitors.lock() {
        *pm = monitors;
    }

    let overlay =
        WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
            .title("Glimpse capture")
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;

    overlay
        .set_position(PhysicalPosition::new(mon_x, mon_y))
        .map_err(|e| e.to_string())?;
    overlay
        .set_size(PhysicalSize::new(mon_w, mon_h))
        .map_err(|e| e.to_string())?;

    Ok(())
}

unsafe extern "system" fn enum_hwnds_proc(hwnd: isize, l_param: isize) -> i32 {
    let vec_ptr = l_param as *mut Vec<isize>;
    if !vec_ptr.is_null() {
        unsafe {
            (*vec_ptr).push(hwnd);
        }
    }
    1
}

fn enum_top_level_hwnds() -> Vec<isize> {
    let mut hwnds: Vec<isize> = Vec::with_capacity(64);
    let ptr = &mut hwnds as *mut Vec<isize> as isize;
    unsafe {
        EnumWindows(enum_hwnds_proc, ptr);
    }
    hwnds
}

fn is_hwnd_cloaked(hwnd: isize) -> bool {
    let mut cloaked: u32 = 0;
    let hr = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        )
    };
    hr == 0 && cloaked != 0
}

fn get_hwnd_class_name(hwnd: isize) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

fn get_hwnd_title(hwnd: isize) -> String {
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return String::new();
    }
    let mut buf = vec![0u16; (len + 1) as usize];
    let read_len = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if read_len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..read_len as usize])
}

fn get_hwnd_bounds(hwnd: isize) -> Option<WinRect> {
    let mut rect = WinRect::default();
    let hr = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut WinRect as *mut c_void,
            std::mem::size_of::<WinRect>() as u32,
        )
    };
    if hr == 0 && rect.right > rect.left && rect.bottom > rect.top {
        return Some(rect);
    }
    let ok = unsafe { GetWindowRect(hwnd, &mut rect) };
    if ok != 0 && rect.right > rect.left && rect.bottom > rect.top {
        Some(rect)
    } else {
        None
    }
}

fn get_minimized_normal_size(hwnd: isize) -> (u32, u32) {
    let mut wp = WindowPlacement {
        length: std::mem::size_of::<WindowPlacement>() as u32,
        ..Default::default()
    };
    let ok = unsafe { GetWindowPlacement(hwnd, &mut wp) };
    if ok != 0 {
        let w = wp.rc_normal_position.right - wp.rc_normal_position.left;
        let h = wp.rc_normal_position.bottom - wp.rc_normal_position.top;
        if w >= 60 && h >= 60 {
            return (w as u32, h as u32);
        }
    }
    (1024, 640)
}

fn is_ignored_window(title: &str, app_name: &str, class_name: &str) -> bool {
    let t = title.trim().to_lowercase();
    let a = app_name.trim().to_lowercase();
    let c = class_name.trim().to_lowercase();

    // System / desktop / shell classes that are not real application windows
    let ignored_classes = [
        "progman",
        "workerw",
        "shell_traywnd",
        "shell_secondarytraywnd",
        "cef-osc-widget",
        "nvidia share",
        "ime",
        "msctfime ui",
        "xamlexplorerhostislandwindow",
        "toplevelwindowforoverflowxamlisland",
        "windows.ui.core.corewindow",
        " NarratorHelperWindow",
    ];
    if ignored_classes
        .iter()
        .any(|ic| c == ic.trim().to_lowercase())
    {
        return true;
    }

    // Overlays and background system hosts (e.g. NVIDIA GeForce Overlay, Game Bar, IME)
    let ignored_keywords = [
        "nvidia geforce overlay",
        "nvidia share",
        "nvidia overlay",
        "nvcontainer",
        "program manager",
        "windows input experience",
        "expérience d’entrée windows",
        "expérience d'entrée windows",
        "default ime",
        "msctfime ui",
        "textinputhost",
        "searchhost",
        "shellexperiencehost",
        "startmenuexperiencehost",
        "xbox game bar",
        "radeon software overlay",
    ];
    ignored_keywords
        .iter()
        .any(|kw| t.contains(kw) || a.contains(kw))
}

fn collect_open_windows(mon_x: i32, mon_y: i32, mon_w: u32, mon_h: u32) -> Vec<WindowRect> {
    let our_pid = std::process::id();

    // Build a lookup table of nice application names from xcap where available
    let mut xcap_id_app: HashMap<u32, String> = HashMap::new();
    let mut xcap_pid_app: HashMap<u32, String> = HashMap::new();
    if let Ok(xcap_windows) = Window::all() {
        for w in xcap_windows {
            let id = w.id().unwrap_or(0);
            let pid = w.pid().unwrap_or(0);
            let app = w.app_name().unwrap_or_default();
            if !app.trim().is_empty() {
                if id != 0 {
                    xcap_id_app.insert(id, app.clone());
                }
                if pid != 0 {
                    xcap_pid_app.entry(pid).or_insert(app);
                }
            }
        }
    }

    let mut visible_list = Vec::new();
    let mut minimized_list = Vec::new();

    for hwnd in enum_top_level_hwnds() {
        if unsafe { IsWindow(hwnd) == 0 || IsWindowVisible(hwnd) == 0 } {
            continue;
        }

        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if pid == 0 || pid == our_pid {
            continue;
        }

        let is_minimized = unsafe { IsIconic(hwnd) != 0 };
        let is_cloaked = is_hwnd_cloaked(hwnd);
        if is_cloaked && !is_minimized {
            continue;
        }

        let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 };
        // Skip click-through overlays (like NVIDIA GeForce Overlay), floating toolwindows, and non-activatable HUDs
        if (ex_style & WS_EX_TRANSPARENT) != 0 {
            continue;
        }
        if (ex_style & WS_EX_TOOLWINDOW) != 0 && (ex_style & WS_EX_APPWINDOW) == 0 {
            continue;
        }
        if (ex_style & WS_EX_NOACTIVATE) != 0 && (ex_style & WS_EX_APPWINDOW) == 0 {
            continue;
        }

        let class_name = get_hwnd_class_name(hwnd);
        if class_name.is_empty() || (class_name == "ApplicationFrameWindow" && is_cloaked) {
            continue;
        }

        let title = get_hwnd_title(hwnd);
        if title.trim().is_empty() {
            continue;
        }

        let id = hwnd as u32;
        let app_name = xcap_id_app
            .get(&id)
            .cloned()
            .or_else(|| xcap_pid_app.get(&pid).cloned())
            .unwrap_or_else(|| match class_name.as_str() {
                "CabinetWClass" => "Explorateur de fichiers".to_string(),
                "ConsoleWindowClass" | "CASCADIA_HOSTING_WINDOW_CLASS" => {
                    "Invite de commandes / Terminal".to_string()
                }
                _ => String::new(),
            });

        if is_ignored_window(&title, &app_name, &class_name) {
            continue;
        }

        if is_minimized {
            let (ww, wh) = get_minimized_normal_size(hwnd);
            minimized_list.push(WindowRect {
                id,
                app_name,
                title,
                x: 0,
                y: 0,
                width: ww,
                height: wh,
                on_current_monitor: false,
                is_minimized: true,
            });
            continue;
        }

        let Some(rect) = get_hwnd_bounds(hwnd) else {
            continue;
        };
        let wx = rect.left;
        let wy = rect.top;
        let ww = (rect.right - rect.left).max(0) as u32;
        let wh = (rect.bottom - rect.top).max(0) as u32;
        if ww < 60 || wh < 60 {
            continue;
        }

        // Check overlap with the current monitor for hover highlighting
        let rel_x1 = (wx - mon_x).clamp(0, mon_w as i32) as u32;
        let rel_y1 = (wy - mon_y).clamp(0, mon_h as i32) as u32;
        let rel_x2 = (wx + ww as i32 - mon_x).clamp(0, mon_w as i32) as u32;
        let rel_y2 = (wy + wh as i32 - mon_y).clamp(0, mon_h as i32) as u32;

        let cw = rel_x2.saturating_sub(rel_x1);
        let ch = rel_y2.saturating_sub(rel_y1);
        let on_current = cw >= 40 && ch >= 40;

        visible_list.push(WindowRect {
            id,
            app_name,
            title,
            x: if on_current { rel_x1 } else { 0 },
            y: if on_current { rel_y1 } else { 0 },
            width: if on_current { cw } else { ww },
            height: if on_current { ch } else { wh },
            on_current_monitor: on_current,
            is_minimized: false,
        });
    }

    // Keep front-to-back Z-order for visible windows (crucial for accurate mouse hover),
    // followed by minimized taskbar applications so the user can pick them from the list.
    visible_list.extend(minimized_list);
    visible_list
}

/// Size + open windows + connected monitors (called by the overlay page).
#[tauri::command]
pub fn get_capture_info(state: State<CaptureState>) -> Result<CaptureInfo, String> {
    let pending = state.pending.lock().map_err(|e| e.to_string())?;
    let img = pending.as_ref().ok_or("no pending capture")?;
    let windows = state
        .pending_windows
        .lock()
        .map(|w| w.clone())
        .unwrap_or_default();
    let monitors = state
        .pending_monitors
        .lock()
        .map(|m| m.clone())
        .unwrap_or_default();
    Ok(CaptureInfo {
        width: img.width(),
        height: img.height(),
        windows,
        monitors,
    })
}

/// Raw RGBA bytes of the pending screenshot (fast binary IPC, no encoding).
#[tauri::command]
pub fn get_capture_pixels(state: State<CaptureState>) -> Result<tauri::ipc::Response, String> {
    let pending = state.pending.lock().map_err(|e| e.to_string())?;
    let img = pending.as_ref().ok_or("no pending capture")?;
    Ok(tauri::ipc::Response::new(img.as_raw().clone()))
}

/// Crop the selection (Rectangle, hovered Window, or current Fullscreen).
#[tauri::command]
pub fn finish_capture(
    app: AppHandle,
    state: State<CaptureState>,
    region: Region,
) -> Result<(), String> {
    let image = state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("no pending capture")?;

    close_overlay(&app);

    let x = region.x.min(image.width().saturating_sub(1));
    let y = region.y.min(image.height().saturating_sub(1));
    let w = region.width.min(image.width() - x).max(1);
    let h = region.height.min(image.height() - y).max(1);
    let cropped = imageops::crop_imm(&image, x, y, w, h).to_image();

    deliver_captured_image(&app, &state, cropped)
}

fn is_image_blank_or_black(img: &RgbaImage) -> bool {
    let w = img.width();
    let h = img.height();
    if w < 16 || h < 16 {
        return true;
    }
    let step_x = (w / 24).max(1);
    let step_y = (h / 24).max(1);
    for y in (0..h).step_by(step_y as usize) {
        for x in (0..w).step_by(step_x as usize) {
            let p = img.get_pixel(x, y).0;
            if p[3] > 10 && (p[0] > 6 || p[1] > 6 || p[2] > 6) {
                return false;
            }
        }
    }
    true
}

fn capture_hwnd_from_monitor(hwnd: isize) -> Result<RgbaImage, String> {
    let rect = get_hwnd_bounds(hwnd)
        .ok_or_else(|| "Impossible de lire les dimensions de la fenêtre".to_string())?;
    let cx = rect.left + (rect.right - rect.left) / 2;
    let cy = rect.top + (rect.bottom - rect.top) / 2;

    let monitor = Monitor::from_point(cx, cy).map_err(|e| e.to_string())?;
    let mon_x = monitor.x().unwrap_or(0);
    let mon_y = monitor.y().unwrap_or(0);
    let mon_img = monitor.capture_image().map_err(|e| e.to_string())?;
    let mon_w = mon_img.width();
    let mon_h = mon_img.height();

    let x1 = (rect.left - mon_x).clamp(0, mon_w as i32) as u32;
    let y1 = (rect.top - mon_y).clamp(0, mon_h as i32) as u32;
    let x2 = (rect.right - mon_x).clamp(0, mon_w as i32) as u32;
    let y2 = (rect.bottom - mon_y).clamp(0, mon_h as i32) as u32;

    let cw = x2.saturating_sub(x1).max(1);
    let ch = y2.saturating_sub(y1).max(1);

    Ok(imageops::crop_imm(&mon_img, x1, y1, cw, ch).to_image())
}

/// Capture a specific open application window by its OS handle/id (even if minimized, behind other windows, or on another monitor).
#[tauri::command]
pub fn capture_window_by_id(
    app: AppHandle,
    state: State<CaptureState>,
    window_id: u32,
) -> Result<(), String> {
    if let Ok(mut pending) = state.pending.lock() {
        *pending = None;
    }

    let hwnd = window_id as isize;
    if unsafe { IsWindow(hwnd) == 0 } {
        close_overlay(&app);
        return Err("Fenêtre introuvable ou fermée".to_string());
    }

    // Restore and bring the target window to front while our overlay still holds foreground permission
    let was_minimized = unsafe { IsIconic(hwnd) != 0 };
    unsafe {
        if was_minimized {
            ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd);
        BringWindowToTop(hwnd);
    }

    close_overlay(&app);
    std::thread::sleep(Duration::from_millis(if was_minimized { 280 } else { 140 }));

    // Try xcap PrintWindow capture first; if it fails or returns a blank/black surface, fallback to monitor crop
    let xcap_img = Window::all()
        .ok()
        .and_then(|wins| wins.into_iter().find(|w| w.id().unwrap_or(0) == window_id))
        .and_then(|w| w.capture_image().ok())
        .filter(|img| !is_image_blank_or_black(img));

    let img = match xcap_img {
        Some(valid_img) => valid_img,
        None => capture_hwnd_from_monitor(hwnd)?,
    };

    deliver_captured_image(&app, &state, img)
}

/// Capture an entire monitor by its id (from the multi-screen picker).
#[tauri::command]
pub fn capture_monitor_by_id(
    app: AppHandle,
    state: State<CaptureState>,
    monitor_id: u32,
) -> Result<(), String> {
    if let Ok(mut pending) = state.pending.lock() {
        *pending = None;
    }
    close_overlay(&app);

    let all_monitors = Monitor::all().map_err(|e| e.to_string())?;
    let target = all_monitors
        .into_iter()
        .find(|m| m.id().unwrap_or(0) == monitor_id)
        .ok_or_else(|| "Écran introuvable".to_string())?;

    let img = target.capture_image().map_err(|e| e.to_string())?;
    deliver_captured_image(&app, &state, img)
}

/// Move the capture overlay to another monitor so the user can select a region on that monitor.
#[tauri::command]
pub fn switch_capture_monitor(app: AppHandle, monitor_id: u32) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run_capture(&app, Some(monitor_id)) {
            eprintln!("[glimpse] switch monitor failed: {err}");
        }
    });
}

/// Receive a freeform (lasso) RGBA cutout with transparent background, copy to clipboard, and open editor.
#[tauri::command]
pub fn finish_freeform_capture(
    app: AppHandle,
    state: State<CaptureState>,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
) -> Result<(), String> {
    if let Ok(mut pending) = state.pending.lock() {
        *pending = None;
    }
    close_overlay(&app);

    let cutout = RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "invalid RGBA buffer".to_string())?;
    deliver_captured_image(&app, &state, cutout)
}

pub(crate) fn deliver_captured_image(
    app: &AppHandle,
    state: &State<CaptureState>,
    img: RgbaImage,
) -> Result<(), String> {
    let (w, h) = (img.width(), img.height());
    copy_to_clipboard(&img)?;

    if let Ok(mut captured) = state.captured.lock() {
        *captured = Some(img);
    }

    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    app.emit_to(MAIN_LABEL, "capture-copied", (w, h))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Abort the selection (Esc / right click).
#[tauri::command]
pub fn cancel_capture(app: AppHandle, state: State<CaptureState>) {
    if let Ok(mut pending) = state.pending.lock() {
        *pending = None;
    }
    close_overlay(&app);
}

/// Size of the last cropped capture (called by the main editor window).
#[tauri::command]
pub fn get_editor_image_info(state: State<CaptureState>) -> Result<CaptureInfo, String> {
    let captured = state.captured.lock().map_err(|e| e.to_string())?;
    let img = captured.as_ref().ok_or("no captured image")?;
    Ok(CaptureInfo {
        width: img.width(),
        height: img.height(),
        windows: Vec::new(),
        monitors: Vec::new(),
    })
}

/// Raw RGBA bytes of the last cropped capture (called by the main editor window).
#[tauri::command]
pub fn get_editor_image_pixels(state: State<CaptureState>) -> Result<tauri::ipc::Response, String> {
    let captured = state.captured.lock().map_err(|e| e.to_string())?;
    let img = captured.as_ref().ok_or("no captured image")?;
    Ok(tauri::ipc::Response::new(img.as_raw().clone()))
}

/// Copy an annotated PNG buffer from the editor to the system clipboard.
#[tauri::command]
pub fn copy_annotated_image(png_bytes: Vec<u8>) -> Result<(), String> {
    let img = xcap::image::load_from_memory(&png_bytes)
        .map_err(|e| format!("invalid PNG buffer: {e}"))?
        .to_rgba8();
    copy_to_clipboard(&img)
}

/// Open a native Save As dialog (PNG / JPEG) and write the annotated image to disk.
#[tauri::command]
pub async fn save_annotated_image(
    app: AppHandle,
    png_bytes: Vec<u8>,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.set_always_on_top(false);
    }

    let base_name = default_name
        .map(|n| sanitize_filename(&n))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Glimpse".to_string());
    let file_name = if base_name.to_ascii_lowercase().ends_with(".png")
        || base_name.to_ascii_lowercase().ends_with(".jpg")
    {
        base_name
    } else {
        format!("{base_name}.png")
    };

    let file_path = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("Enregistrer la capture")
            .set_file_name(&file_name)
            .add_filter("Image PNG (*.png)", &["png"])
            .add_filter("Image JPEG (*.jpg, *.jpeg)", &["jpg", "jpeg"])
            .save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.set_always_on_top(crate::settings::get_settings().always_on_top);
    }

    let Some(path) = file_path else {
        return Ok(None);
    };

    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();

    if ext == "jpg" || ext == "jpeg" {
        let img = xcap::image::load_from_memory(&png_bytes)
            .map_err(|e| format!("invalid PNG buffer: {e}"))?
            .to_rgba8();
        let rgb = DynamicImage::ImageRgba8(img).into_rgb8();
        rgb.save(&path).map_err(|e| e.to_string())?;
    } else {
        std::fs::write(&path, &png_bytes).map_err(|e| e.to_string())?;
    }

    Ok(Some(path.display().to_string()))
}

fn sanitize_filename(raw: &str) -> String {
    raw.trim()
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect()
}

/// Save multiple independent photos at once into a chosen folder as separate PNG files.
#[tauri::command]
pub async fn save_multiple_images(
    app: AppHandle,
    files: Vec<(String, Vec<u8>)>,
) -> Result<Option<usize>, String> {
    if files.is_empty() {
        return Ok(None);
    }
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.set_always_on_top(false);
    }

    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choisir le dossier où enregistrer les photos")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.set_always_on_top(crate::settings::get_settings().always_on_top);
    }

    let Some(dir) = folder else {
        return Ok(None);
    };

    let mut saved = 0usize;
    for (idx, (raw_name, png_bytes)) in files.into_iter().enumerate() {
        let clean = sanitize_filename(&raw_name);
        let stem = if clean.is_empty() {
            format!("Capture_{}", idx + 1)
        } else {
            clean
        };
        let mut target = dir.join(format!("{stem}.png"));
        let mut suffix = 2usize;
        while target.exists() {
            target = dir.join(format!("{stem}_{suffix}.png"));
            suffix += 1;
        }
        std::fs::write(&target, &png_bytes).map_err(|e| e.to_string())?;
        saved += 1;
    }

    Ok(Some(saved))
}

fn close_overlay(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = overlay.destroy();
    }
}

fn copy_to_clipboard(img: &RgbaImage) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: img.width() as usize,
            height: img.height() as usize,
            bytes: std::borrow::Cow::Borrowed(img.as_raw()),
        })
        .map_err(|e| e.to_string())
}
