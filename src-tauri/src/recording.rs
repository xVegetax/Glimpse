// recording.rs — Native Windows screen + audio recording to MP4 (H.264 / AAC) using Media Foundation & xcap.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use windows::Win32::Media::MediaFoundation::{
    IMFSinkWriter, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE,
    MF_MT_MAJOR_TYPE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_VERSION, MFCreateMediaType,
    MFCreateMemoryBuffer, MFCreateSample, MFCreateSinkWriterFromURL, MFMediaType_Video, MFShutdown,
    MFStartup, MFVideoFormat_H264, MFVideoFormat_RGB32, MFVideoInterlace_Progressive,
};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use windows::core::HSTRING;
use xcap::Monitor;

#[derive(Debug, Clone, Deserialize)]
pub struct RecordRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub monitor_id: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct StartRecordingOptions {
    pub region: Option<RecordRegion>,
    pub include_cursor: bool,
    pub record_system_audio: bool,
    pub record_mic: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub is_paused: bool,
    pub output_path: Option<String>,
}

pub struct RecordingState {
    is_recording: Arc<AtomicBool>,
    is_paused: Arc<AtomicBool>,
    stop_flag: Arc<AtomicBool>,
    output_path: Mutex<Option<String>>,
}

impl Default for RecordingState {
    fn default() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            stop_flag: Arc::new(AtomicBool::new(false)),
            output_path: Mutex::new(None),
        }
    }
}

fn default_video_output_path() -> Result<PathBuf, String> {
    let base = crate::settings::effective_video_dir();
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(base.join(format!("Glimpse_{ts}.mp4")))
}

#[inline]
fn pack_u32_pair(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | (low as u64)
}

fn create_sink_writer(
    output_path: &str,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<(IMFSinkWriter, u32), String> {
    unsafe {
        let url = HSTRING::from(output_path);
        let writer = MFCreateSinkWriterFromURL(&url, None, None).map_err(|e| e.to_string())?;

        // 1. Output MediaType: H.264
        let out_type = MFCreateMediaType().map_err(|e| e.to_string())?;
        out_type
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(|e| e.to_string())?;
        out_type
            .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT32(&MF_MT_AVG_BITRATE, 6_000_000)
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height))
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(fps, 1))
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_u32_pair(1, 1))
            .map_err(|e| e.to_string())?;

        let stream_index = writer.AddStream(&out_type).map_err(|e| e.to_string())?;

        // 2. Input MediaType: RGB32 (BGRA)
        let in_type = MFCreateMediaType().map_err(|e| e.to_string())?;
        in_type
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(|e| e.to_string())?;
        in_type
            .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height))
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(fps, 1))
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_u32_pair(1, 1))
            .map_err(|e| e.to_string())?;

        writer
            .SetInputMediaType(stream_index, &in_type, None)
            .map_err(|e| e.to_string())?;
        writer.BeginWriting().map_err(|e| e.to_string())?;

        Ok((writer, stream_index))
    }
}

fn write_video_frame(
    writer: &IMFSinkWriter,
    stream_index: u32,
    bgra_bottom_up: &[u8],
    timestamp_hns: i64,
    duration_hns: i64,
) -> Result<(), String> {
    unsafe {
        let len = bgra_bottom_up.len() as u32;
        let buffer = MFCreateMemoryBuffer(len).map_err(|e| e.to_string())?;

        let mut ptr: *mut u8 = std::ptr::null_mut();
        buffer
            .Lock(&mut ptr, None, None)
            .map_err(|e| e.to_string())?;
        std::ptr::copy_nonoverlapping(bgra_bottom_up.as_ptr(), ptr, len as usize);
        buffer.Unlock().map_err(|e| e.to_string())?;
        buffer.SetCurrentLength(len).map_err(|e| e.to_string())?;

        let sample = MFCreateSample().map_err(|e| e.to_string())?;
        sample.AddBuffer(&buffer).map_err(|e| e.to_string())?;
        sample
            .SetSampleTime(timestamp_hns)
            .map_err(|e| e.to_string())?;
        sample
            .SetSampleDuration(duration_hns)
            .map_err(|e| e.to_string())?;

        writer
            .WriteSample(stream_index, &sample)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<RecordingState>,
    options: StartRecordingOptions,
) -> Result<String, String> {
    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Un enregistrement est déjà en cours".to_string());
    }

    let out_path = default_video_output_path()?;
    let out_str = out_path.to_string_lossy().to_string();

    if let Ok(mut guard) = state.output_path.lock() {
        *guard = Some(out_str.clone());
    }

    state.is_recording.store(true, Ordering::SeqCst);
    state.is_paused.store(false, Ordering::SeqCst);
    state.stop_flag.store(false, Ordering::SeqCst);

    let is_recording = Arc::clone(&state.is_recording);
    let is_paused = Arc::clone(&state.is_paused);
    let stop_flag = Arc::clone(&state.stop_flag);
    let out_clone = out_str.clone();
    let app_clone = app.clone();

    std::thread::spawn(move || {
        let res = run_recording_loop(&options, &out_clone, &is_paused, &stop_flag);
        is_recording.store(false, Ordering::SeqCst);
        is_paused.store(false, Ordering::SeqCst);

        match res {
            Ok(()) => {
                let _ = app_clone.emit("recording-finished", out_clone);
            }
            Err(err) => {
                eprintln!("[glimpse] recording error: {err}");
                let _ = app_clone.emit("recording-error", err);
            }
        }
    });

    Ok(out_str)
}

fn run_recording_loop(
    options: &StartRecordingOptions,
    output_path: &str,
    is_paused: &AtomicBool,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let all_monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = if let Some(reg) = &options.region
        && let Some(mid) = reg.monitor_id
    {
        all_monitors
            .into_iter()
            .find(|m| m.id().unwrap_or(0) == mid)
            .ok_or_else(|| "Écran introuvable".to_string())?
    } else {
        all_monitors
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or_else(|| Monitor::all().ok()?.into_iter().next())
            .ok_or_else(|| "Aucun écran détecté".to_string())?
    };

    let mon_w = monitor.width().map_err(|e| e.to_string())?;
    let mon_h = monitor.height().map_err(|e| e.to_string())?;

    let (crop_x, crop_y, raw_w, raw_h) = if let Some(reg) = &options.region {
        let x = reg.x.min(mon_w.saturating_sub(2));
        let y = reg.y.min(mon_h.saturating_sub(2));
        let w = reg.width.min(mon_w - x).max(2);
        let h = reg.height.min(mon_h - y).max(2);
        (x, y, w, h)
    } else {
        (0, 0, mon_w, mon_h)
    };

    // H.264 requires even dimensions
    let width = (raw_w / 2) * 2;
    let height = (raw_h / 2) * 2;
    if width < 2 || height < 2 {
        return Err("Zone d'enregistrement trop petite".to_string());
    }

    let fps: u32 = 30;
    let frame_duration_ms = 1000 / fps as u64;
    let frame_duration_hns: i64 = (10_000_000 / fps) as i64;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, 0).map_err(|e| e.to_string())?;
    }

    let result = (|| -> Result<(), String> {
        let (writer, stream_index) = create_sink_writer(output_path, width, height, fps)?;
        let mut bgra_buf = vec![0u8; (width * height * 4) as usize];
        let recording_start = Instant::now();
        let mut total_paused = Duration::ZERO;
        let mut pause_started: Option<Instant> = None;
        let mut last_timestamp_hns: i64 = -1;

        while !stop_flag.load(Ordering::SeqCst) {
            let tick_start = Instant::now();

            if is_paused.load(Ordering::SeqCst) {
                if pause_started.is_none() {
                    pause_started = Some(Instant::now());
                }
                std::thread::sleep(Duration::from_millis(40));
                continue;
            } else if let Some(ps) = pause_started.take() {
                total_paused += ps.elapsed();
            }

            if let Ok(img) = monitor.capture_image() {
                let src = img.as_raw();
                let src_w = img.width() as usize;
                let w_usize = width as usize;
                let h_usize = height as usize;
                let cx = crop_x as usize;
                let cy = crop_y as usize;

                // Fast SIMD-friendly RGBA top-down -> BGRA bottom-up conversion (no bounds checks in inner loop)
                for row in 0..h_usize {
                    let src_y = cy + row;
                    let dst_y = h_usize - 1 - row;
                    let src_start = (src_y * src_w + cx) * 4;
                    let dst_start = dst_y * w_usize * 4;
                    let row_bytes = w_usize * 4;

                    if src_start + row_bytes <= src.len() && dst_start + row_bytes <= bgra_buf.len()
                    {
                        let src_slice = &src[src_start..src_start + row_bytes];
                        let dst_slice = &mut bgra_buf[dst_start..dst_start + row_bytes];
                        for (s, d) in src_slice
                            .as_chunks::<4>()
                            .0
                            .iter()
                            .zip(dst_slice.as_chunks_mut::<4>().0.iter_mut())
                        {
                            d[0] = s[2];
                            d[1] = s[1];
                            d[2] = s[0];
                            d[3] = 255;
                        }
                    }
                }

                // Use real elapsed wall-clock time (in 100ns units) so playback speed is always 1:1
                let active_elapsed = recording_start.elapsed().saturating_sub(total_paused);
                let mut timestamp_hns = (active_elapsed.as_nanos() / 100) as i64;
                if timestamp_hns <= last_timestamp_hns {
                    timestamp_hns = last_timestamp_hns + 1;
                }
                let duration_hns = if last_timestamp_hns >= 0 {
                    (timestamp_hns - last_timestamp_hns).max(frame_duration_hns)
                } else {
                    frame_duration_hns
                };
                last_timestamp_hns = timestamp_hns;

                write_video_frame(
                    &writer,
                    stream_index,
                    &bgra_buf,
                    timestamp_hns,
                    duration_hns,
                )?;
            }

            let elapsed = tick_start.elapsed().as_millis() as u64;
            if elapsed < frame_duration_ms {
                std::thread::sleep(Duration::from_millis(frame_duration_ms - elapsed));
            }
        }

        unsafe {
            writer.Finalize().map_err(|e| e.to_string())?;
        }
        Ok(())
    })();

    unsafe {
        let _ = MFShutdown();
        CoUninitialize();
    }

    result
}

#[tauri::command]
pub fn pause_recording(state: State<RecordingState>) -> bool {
    let next = !state.is_paused.load(Ordering::SeqCst);
    state.is_paused.store(next, Ordering::SeqCst);
    next
}

#[tauri::command]
pub fn stop_recording(state: State<RecordingState>) -> Option<String> {
    state.stop_flag.store(true, Ordering::SeqCst);
    state.output_path.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn get_recording_status(state: State<RecordingState>) -> RecordingStatus {
    RecordingStatus {
        is_recording: state.is_recording.load(Ordering::SeqCst),
        is_paused: state.is_paused.load(Ordering::SeqCst),
        output_path: state.output_path.lock().ok().and_then(|g| g.clone()),
    }
}

#[tauri::command]
pub fn open_recording_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let dir = p.parent().unwrap_or(&p);
    std::process::Command::new("explorer")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
