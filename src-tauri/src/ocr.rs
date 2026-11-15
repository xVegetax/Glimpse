// ocr.rs — Native Windows 11 OCR (Windows.Media.Ocr) for extracting and redacting text on captures.

use serde::Serialize;
use tauri::State;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::core::HSTRING;

use crate::capture::CaptureState;

#[derive(Clone, Serialize)]
pub struct OcrWordBox {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Serialize)]
pub struct OcrLineBox {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub words: Vec<OcrWordBox>,
}

#[derive(Clone, Serialize)]
pub struct OcrResponse {
    pub full_text: String,
    pub lines: Vec<OcrLineBox>,
}

fn create_ocr_engine() -> Result<OcrEngine, String> {
    if let Ok(engine) = OcrEngine::TryCreateFromUserProfileLanguages() {
        return Ok(engine);
    }
    for tag in ["fr-FR", "fr", "en-US", "en"] {
        if let Ok(lang) = Language::CreateLanguage(&HSTRING::from(tag))
            && OcrEngine::IsLanguageSupported(&lang).unwrap_or(false)
            && let Ok(engine) = OcrEngine::TryCreateFromLanguage(&lang)
        {
            return Ok(engine);
        }
    }
    Err("Aucun pack de langue OCR Windows n'est disponible sur ce système".to_string())
}

fn run_winrt_ocr(width: u32, height: u32, rgba: &[u8]) -> Result<OcrResponse, String> {
    if width == 0 || height == 0 || rgba.len() < (width as usize * height as usize * 4) {
        return Err("Dimensions d'image OCR invalides".to_string());
    }

    // Windows.Media.Ocr works best when dimensions are at least 64x64.
    // Pad small captures at bottom/right without shifting top-left (0, 0) coordinates.
    let work_w = width.max(64);
    let work_h = height.max(64);
    let mut bgra = vec![255u8; (work_w as usize) * (work_h as usize) * 4];

    for y in 0..height as usize {
        let src_row = y * (width as usize) * 4;
        let dst_row = y * (work_w as usize) * 4;
        for x in 0..width as usize {
            let s = src_row + x * 4;
            let d = dst_row + x * 4;
            let a = rgba[s + 3];
            if a < 16 {
                // Replace transparent background (e.g. from Freeform lasso) with white for contrast
                bgra[d] = 255;
                bgra[d + 1] = 255;
                bgra[d + 2] = 255;
                bgra[d + 3] = 255;
            } else {
                bgra[d] = rgba[s + 2];
                bgra[d + 1] = rgba[s + 1];
                bgra[d + 2] = rgba[s];
                bgra[d + 3] = a;
            }
        }
    }

    let writer = DataWriter::new().map_err(|e| e.to_string())?;
    writer.WriteBytes(&bgra).map_err(|e| e.to_string())?;
    let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;

    let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        work_w as i32,
        work_h as i32,
        BitmapAlphaMode::Premultiplied,
    )
    .map_err(|e| e.to_string())?;

    let engine = create_ocr_engine()?;
    let async_op = engine.RecognizeAsync(&bitmap).map_err(|e| e.to_string())?;
    let ocr_result = async_op.join().map_err(|e| e.to_string())?;

    let raw_lines = ocr_result.Lines().map_err(|e| e.to_string())?;
    let mut lines = Vec::new();
    let mut full_lines_text = Vec::new();

    for line in &raw_lines {
        let line_text = line.Text().map(|s| s.to_string()).unwrap_or_default();
        let raw_words = line.Words().map_err(|e| e.to_string())?;

        let mut words = Vec::new();
        let mut min_x = f32::MAX;
        let mut min_y = f32::MAX;
        let mut max_x = 0.0f32;
        let mut max_y = 0.0f32;

        for w in &raw_words {
            let w_text = w.Text().map(|s| s.to_string()).unwrap_or_default();
            if let Ok(rect) = w.BoundingRect() {
                if rect.X < min_x {
                    min_x = rect.X;
                }
                if rect.Y < min_y {
                    min_y = rect.Y;
                }
                if rect.X + rect.Width > max_x {
                    max_x = rect.X + rect.Width;
                }
                if rect.Y + rect.Height > max_y {
                    max_y = rect.Y + rect.Height;
                }
                words.push(OcrWordBox {
                    text: w_text,
                    x: rect.X,
                    y: rect.Y,
                    width: rect.Width,
                    height: rect.Height,
                });
            }
        }

        if !line_text.trim().is_empty() && min_x < max_x && min_y < max_y {
            full_lines_text.push(line_text.clone());
            lines.push(OcrLineBox {
                text: line_text,
                x: min_x,
                y: min_y,
                width: max_x - min_x,
                height: max_y - min_y,
                words,
            });
        }
    }

    Ok(OcrResponse {
        full_text: full_lines_text.join("\n"),
        lines,
    })
}

/// Run Windows native OCR on either the provided RGBA buffer (if cropped in editor)
/// or directly on the current captured image in memory.
#[tauri::command]
pub async fn recognize_image_text(
    state: State<'_, CaptureState>,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
) -> Result<OcrResponse, String> {
    let (w, h, bytes) = if width > 0 && height > 0 && !rgba.is_empty() {
        (width, height, rgba)
    } else {
        let img = state
            .cloned_captured()
            .ok_or_else(|| "Aucune capture disponible pour l'OCR".to_string())?;
        (img.width(), img.height(), img.into_raw())
    };

    tauri::async_runtime::spawn_blocking(move || run_winrt_ocr(w, h, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

/// Copy extracted OCR text to the Windows clipboard.
#[tauri::command]
pub fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}
