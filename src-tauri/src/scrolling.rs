// scrolling.rs — Reliable automatic scrolling capture (Win32 focus + stabilized scroll + high-contrast band stitcher).

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};
use xcap::image::{self, RgbaImage};
use xcap::{Monitor, Window};

use crate::capture::{CaptureState, deliver_captured_image};

const MOUSEEVENTF_WHEEL: u32 = 0x0800;
const GA_ROOT: u32 = 2;

#[repr(C)]
#[derive(Clone, Copy)]
#[allow(clippy::upper_case_acronyms)]
struct POINT {
    x: i32,
    y: i32,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn SetCursorPos(x: i32, y: i32) -> i32;
    fn mouse_event(dwFlags: u32, dx: u32, dy: u32, dwData: i32, dwExtraInfo: usize);
    fn WindowFromPoint(pt: POINT) -> isize;
    fn GetAncestor(hwnd: isize, ga_flags: u32) -> isize;
    fn SetForegroundWindow(hwnd: isize) -> i32;
}

#[derive(Clone, Copy)]
struct ScrollRegion {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

static SCROLL_ACTIVE: AtomicBool = AtomicBool::new(false);
static SCROLL_FRAMES: Mutex<Vec<RgbaImage>> = Mutex::new(Vec::new());

fn focus_window_at(x: i32, y: i32) {
    unsafe {
        SetCursorPos(x, y);
        let hwnd = WindowFromPoint(POINT { x, y });
        if hwnd != 0 {
            let root = GetAncestor(hwnd, GA_ROOT);
            let target = if root != 0 { root } else { hwnd };
            SetForegroundWindow(target);
        }
    }
}

fn capture_region_rgba(r: ScrollRegion) -> Result<RgbaImage, String> {
    let monitors = Monitor::all().map_err(|e| format!("Monitor::all failed: {e}"))?;
    let cx = r.x + (r.width as i32) / 2;
    let cy = r.y + (r.height as i32) / 2;
    let monitor = monitors
        .into_iter()
        .find(|m| {
            let mx = m.x().unwrap_or(0);
            let my = m.y().unwrap_or(0);
            let mw = m.width().unwrap_or(0) as i32;
            let mh = m.height().unwrap_or(0) as i32;
            cx >= mx && cx < mx + mw && cy >= my && cy < my + mh
        })
        .ok_or_else(|| "No monitor found for scrolling region".to_string())?;

    let full = monitor
        .capture_image()
        .map_err(|e| format!("capture_image failed: {e}"))?;
    let mx = monitor.x().unwrap_or(0);
    let my = monitor.y().unwrap_or(0);

    let rel_x = (r.x - mx).max(0) as u32;
    let rel_y = (r.y - my).max(0) as u32;
    let max_w = full.width().saturating_sub(rel_x);
    let max_h = full.height().saturating_sub(rel_y);
    let cw = r.width.min(max_w).max(1);
    let ch = r.height.min(max_h).max(1);

    Ok(image::imageops::crop_imm(&full, rel_x, rel_y, cw, ch).to_image())
}

/// Capture region after waiting for smooth-scrolling animation to settle.
fn capture_settled_region(r: ScrollRegion) -> Result<RgbaImage, String> {
    let snap1 = capture_region_rgba(r)?;
    std::thread::sleep(Duration::from_millis(75));
    let snap2 = capture_region_rgba(r)?;
    if !frames_differ(&snap1, &snap2) {
        return Ok(snap2);
    }
    std::thread::sleep(Duration::from_millis(120));
    capture_region_rgba(r)
}

/// Returns true if `a` and `b` differ visibly in the interior region.
fn frames_differ(a: &RgbaImage, b: &RgbaImage) -> bool {
    if a.width() != b.width() || a.height() != b.height() {
        return true;
    }
    let w = a.width();
    let h = a.height();
    let a_raw = a.as_raw();
    let b_raw = b.as_raw();
    let stride = (w * 4) as usize;
    let mut diff = 0u64;
    let mut samples = 0u64;
    for y in (h / 6..h * 5 / 6).step_by(6) {
        let row = (y as usize) * stride;
        for x in (w / 6..w * 5 / 6).step_by(6) {
            let idx = row + (x as usize) * 4;
            diff += a_raw[idx].abs_diff(b_raw[idx]) as u64
                + a_raw[idx + 1].abs_diff(b_raw[idx + 1]) as u64
                + a_raw[idx + 2].abs_diff(b_raw[idx + 2]) as u64;
            samples += 3;
        }
    }
    samples > 0 && (diff / samples) >= 3
}

/// Select the 14-row horizontal band in `50%..82%` of `img` with the highest horizontal detail/contrast,
/// so we never match against a blank white background.
fn pick_high_contrast_band_y(img: &RgbaImage) -> u32 {
    let w = img.width();
    let h = img.height();
    let raw = img.as_raw();
    let stride = (w * 4) as usize;
    let y_min = (h * 50) / 100;
    let y_max = ((h * 82) / 100).max(y_min + 1);
    let x_start = w / 6;
    let x_end = ((w * 5) / 6).saturating_sub(4);

    let mut best_y = (h * 70) / 100;
    let mut best_contrast = 0u64;

    for cy in (y_min..y_max).step_by(4) {
        let mut contrast = 0u64;
        for r in (0..12u32).step_by(3) {
            if cy + r >= h {
                break;
            }
            let row_off = ((cy + r) as usize) * stride;
            for x in (x_start..x_end).step_by(6) {
                let p0 = row_off + (x as usize) * 4;
                let p1 = p0 + 16;
                contrast += raw[p0].abs_diff(raw[p1]) as u64
                    + raw[p0 + 1].abs_diff(raw[p1 + 1]) as u64
                    + raw[p0 + 2].abs_diff(raw[p1 + 2]) as u64;
            }
        }
        if contrast > best_contrast {
            best_contrast = contrast;
            best_y = cy;
        }
    }
    best_y
}

/// Find `(ref_y_in_prev, scroll_delta)` between `prev` and `next` using high-contrast band matching.
fn find_scroll_match(prev: &RgbaImage, next: &RgbaImage) -> (u32, u32) {
    let w = prev.width().min(next.width());
    let h = prev.height().min(next.height());
    let default_ref = (h * 70) / 100;
    if w < 32 || h < 80 {
        return (default_ref, 0);
    }

    let ref_y = pick_high_contrast_band_y(prev);
    let band_h = 12u32.min(h.saturating_sub(ref_y));
    let min_search_y = 12u32;
    if ref_y <= min_search_y + 8 {
        return (ref_y, 0);
    }

    let p_raw = prev.as_raw();
    let n_raw = next.as_raw();
    let p_stride = (prev.width() * 4) as usize;
    let n_stride = (next.width() * 4) as usize;
    let x_start = w / 6;
    let x_end = (w * 5) / 6;

    let mut best_y = ref_y;
    let mut best_err = u64::MAX;

    for cand_y in min_search_y..(ref_y - 6) {
        let mut err = 0u64;
        let mut samples = 0u64;
        for row in (0..band_h).step_by(2) {
            let p_off = ((ref_y + row) as usize) * p_stride;
            let n_off = ((cand_y + row) as usize) * n_stride;
            for x in (x_start..x_end).step_by(5) {
                let px = (x * 4) as usize;
                let dr = p_raw[p_off + px].abs_diff(n_raw[n_off + px]) as u64;
                let dg = p_raw[p_off + px + 1].abs_diff(n_raw[n_off + px + 1]) as u64;
                let db = p_raw[p_off + px + 2].abs_diff(n_raw[n_off + px + 2]) as u64;
                err += dr + dg + db;
                samples += 3;
            }
        }
        let avg = err / samples.max(1);
        if avg < 16 && err < best_err {
            best_err = err;
            best_y = cand_y;
        }
    }

    (ref_y, ref_y.saturating_sub(best_y))
}

fn stitch_frames(frames: &[RgbaImage]) -> Result<RgbaImage, String> {
    if frames.is_empty() {
        return Err("Aucune capture".to_string());
    }
    if frames.len() == 1 {
        return Ok(frames[0].clone());
    }

    let width = frames[0].width();
    let h = frames[0].height();

    // Build progressive slices: (frame_idx, start_y, copy_height)
    let mut slices: Vec<(usize, u32, u32)> = Vec::new();
    let (first_ref_y, _) = find_scroll_match(&frames[0], &frames[1]);
    let mut cur_anchor_y = first_ref_y.clamp(h / 2, (h * 85) / 100);
    slices.push((0, 0, cur_anchor_y));
    let mut total_h = cur_anchor_y;

    let mut last_idx = 0usize;
    for i in 1..frames.len() {
        let (ref_y, delta) = find_scroll_match(&frames[last_idx], &frames[i]);
        let effective_delta = if delta >= 8 {
            delta
        } else if frames_differ(&frames[last_idx], &frames[i]) {
            // Fallback if page has uniform background: estimate ~320px scroll
            (h * 35 / 100).min(ref_y.saturating_sub(16))
        } else {
            0
        };

        if effective_delta >= 8 {
            // Adjust previous slice bottom to match `ref_y` of `last_idx`
            if let Some(last_slice) = slices.last_mut() {
                let old_h = last_slice.2;
                let new_h = ref_y.saturating_sub(last_slice.1);
                if new_h > 0 {
                    total_h = total_h.saturating_sub(old_h) + new_h;
                    last_slice.2 = new_h;
                }
            }
            let match_y_in_next = ref_y.saturating_sub(effective_delta);
            slices.push((i, match_y_in_next, effective_delta));
            total_h += effective_delta;
            cur_anchor_y = ref_y;
            last_idx = i;
        }
    }

    let tail_h = frames[last_idx].height().saturating_sub(cur_anchor_y);
    if tail_h > 0 {
        slices.push((last_idx, cur_anchor_y, tail_h));
        total_h += tail_h;
    }

    let mut out = RgbaImage::new(width, total_h.max(1));
    let mut cur_y = 0u32;
    for (idx, sy, sh) in slices {
        let img = &frames[idx];
        let copy_h = sh.min(img.height().saturating_sub(sy));
        if copy_h > 0 {
            let cropped = image::imageops::crop_imm(img, 0, sy, width.min(img.width()), copy_h);
            image::imageops::replace(&mut out, &cropped.to_image(), 0, cur_y as i64);
            cur_y += copy_h;
        }
    }
    Ok(out)
}

fn finalize_and_deliver(app: &AppHandle) -> Result<(), String> {
    SCROLL_ACTIVE.store(false, Ordering::SeqCst);
    let frames = {
        let mut guard = SCROLL_FRAMES
            .lock()
            .map_err(|_| "ScrollFrames lock poisoned".to_string())?;
        std::mem::take(&mut *guard)
    };
    if frames.is_empty() {
        return Err("Aucune capture".to_string());
    }
    let stitched = stitch_frames(&frames)?;
    let state: State<CaptureState> = app.state();
    deliver_captured_image(app, &state, stitched)
}

fn begin_auto_scroll(app: AppHandle, region: ScrollRegion) -> Result<usize, String> {
    SCROLL_ACTIVE.store(false, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(60));

    // Place capsule at top-right outside the capture region, then immediately give focus back to target window
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_position(PhysicalPosition::new(region.x + 16, region.y.max(12)));
        let _ = w.show();
    }
    let _ = app.emit_to(
        "main",
        "scrolling-started",
        serde_json::json!({ "count": 1 }),
    );

    let cx = region.x + (region.width as i32) / 2;
    let cy = region.y + (region.height as i32) / 2;
    focus_window_at(cx, cy);
    std::thread::sleep(Duration::from_millis(140));

    let first = capture_region_rgba(region)?;
    {
        let mut guard = SCROLL_FRAMES
            .lock()
            .map_err(|_| "ScrollFrames lock poisoned".to_string())?;
        guard.clear();
        guard.push(first);
    }

    SCROLL_ACTIVE.store(true, Ordering::SeqCst);
    std::thread::spawn(move || {
        let mut stagnant_steps = 0u32;
        while SCROLL_ACTIVE.load(Ordering::SeqCst) {
            // Ensure target window under (cx, cy) has focus and send 3 smooth wheel ticks (-120 each)
            focus_window_at(cx, cy);
            for _ in 0..3 {
                unsafe {
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, -120, 0);
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            // Wait for scroll to settle
            std::thread::sleep(Duration::from_millis(280));
            if !SCROLL_ACTIVE.load(Ordering::SeqCst) {
                break;
            }

            if let Ok(frame) = capture_settled_region(region) {
                let mut new_count = None;
                let mut reached_end = false;
                if let Ok(mut guard) = SCROLL_FRAMES.lock() {
                    let changed = guard.last().is_some_and(|last| frames_differ(last, &frame));
                    if changed {
                        stagnant_steps = 0;
                        guard.push(frame);
                        new_count = Some(guard.len());
                        if guard.len() >= 18 {
                            reached_end = true;
                        }
                    } else {
                        stagnant_steps += 1;
                        if stagnant_steps >= 4 {
                            reached_end = true;
                        }
                    }
                }
                if let Some(c) = new_count {
                    let _ =
                        app.emit_to("main", "scrolling-step", serde_json::json!({ "count": c }));
                }
                if reached_end {
                    let _ = finalize_and_deliver(&app);
                    break;
                }
            }
        }
    });

    Ok(1)
}

#[tauri::command]
pub fn start_scrolling_capture(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<usize, String> {
    if let Some(ov) = app.get_webview_window("overlay") {
        let _ = ov.hide();
        let _ = ov.destroy();
    }
    std::thread::sleep(Duration::from_millis(220));
    begin_auto_scroll(
        app,
        ScrollRegion {
            x,
            y,
            width: width.max(1),
            height: height.max(1),
        },
    )
}

#[tauri::command]
pub fn start_scrolling_window(app: AppHandle, window_id: u32) -> Result<usize, String> {
    if let Some(ov) = app.get_webview_window("overlay") {
        let _ = ov.hide();
        let _ = ov.destroy();
    }
    std::thread::sleep(Duration::from_millis(220));

    let win = Window::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.id().unwrap_or(0) == window_id)
        .ok_or_else(|| "Fenêtre introuvable".to_string())?;

    let wx = win.x().unwrap_or(0);
    let wy = win.y().unwrap_or(0);
    let ww = win.width().unwrap_or(800).max(1);
    let wh = win.height().unwrap_or(600).max(1);
    let top_inset = if wh > 280 { 110u32 } else { 0u32 };
    let right_inset = if ww > 200 { 20u32 } else { 0u32 };
    begin_auto_scroll(
        app,
        ScrollRegion {
            x: wx + 8,
            y: wy + top_inset as i32,
            width: ww.saturating_sub(right_inset + 16).max(1),
            height: wh.saturating_sub(top_inset + 12).max(1),
        },
    )
}

#[tauri::command]
pub fn capture_scroll_step() -> Result<usize, String> {
    let guard = SCROLL_FRAMES
        .lock()
        .map_err(|_| "ScrollFrames lock poisoned".to_string())?;
    Ok(guard.len())
}

#[tauri::command]
pub fn finish_scrolling_capture(app: AppHandle) -> Result<(), String> {
    finalize_and_deliver(&app)
}

#[tauri::command]
pub fn cancel_scrolling_capture() -> Result<(), String> {
    SCROLL_ACTIVE.store(false, Ordering::SeqCst);
    let mut guard = SCROLL_FRAMES
        .lock()
        .map_err(|_| "ScrollFrames lock poisoned".to_string())?;
    guard.clear();
    Ok(())
}
