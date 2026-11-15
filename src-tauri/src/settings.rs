// settings.rs — Persistent user preferences (%APPDATA%\Glimpse\settings.json)
// + Windows startup registry toggle (HKCU\...\Run).

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const APP_VALUE_NAME: &str = "Glimpse";

fn default_glass_opacity() -> u8 {
    85
}

fn default_always_on_top() -> bool {
    true
}

fn default_dock_items() -> Vec<String> {
    vec![
        "capture".to_string(),
        "editor".to_string(),
        "record".to_string(),
    ]
}

fn default_language() -> String {
    "fr".to_string()
}

fn default_open_editor_after_capture() -> bool {
    false
}

fn default_shortcuts() -> HashMap<String, String> {
    let mut map = HashMap::new();
    map.insert("capture".to_string(), "Ctrl+Shift+S".to_string());
    map.insert("copy".to_string(), "Ctrl+C".to_string());
    map.insert("save".to_string(), "Ctrl+S".to_string());
    map.insert("undo".to_string(), "Ctrl+Z".to_string());
    map.insert("redo".to_string(), "Ctrl+Y".to_string());
    map.insert("select".to_string(), "V".to_string());
    map.insert("pen".to_string(), "P".to_string());
    map.insert("highlighter".to_string(), "H".to_string());
    map.insert("line".to_string(), "L".to_string());
    map.insert("arrow".to_string(), "A".to_string());
    map.insert("rect".to_string(), "R".to_string());
    map.insert("text".to_string(), "T".to_string());
    map.insert("emoji".to_string(), "E".to_string());
    map.insert("step".to_string(), "N".to_string());
    map.insert("blur".to_string(), "B".to_string());
    map.insert("eraser".to_string(), "G".to_string());
    map.insert("crop".to_string(), "C".to_string());
    map.insert("ocr".to_string(), "O".to_string());
    map
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    pub launch_on_startup: bool,
    #[serde(default)]
    pub video_dir: Option<String>,
    #[serde(default = "default_glass_opacity")]
    pub glass_opacity: u8,
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    #[serde(default = "default_dock_items")]
    pub dock_items: Vec<String>,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_open_editor_after_capture")]
    pub open_editor_after_capture: bool,
    #[serde(default = "default_shortcuts")]
    pub shortcuts: HashMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            launch_on_startup: false,
            video_dir: None,
            glass_opacity: default_glass_opacity(),
            always_on_top: default_always_on_top(),
            dock_items: default_dock_items(),
            language: default_language(),
            open_editor_after_capture: default_open_editor_after_capture(),
            shortcuts: default_shortcuts(),
        }
    }
}

pub fn effective_video_dir() -> PathBuf {
    let s = get_settings();
    if let Some(custom) = s.video_dir
        && !custom.trim().is_empty()
    {
        return PathBuf::from(custom);
    }
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        return PathBuf::from(userprofile).join("Videos").join("Glimpse");
    }
    PathBuf::from("Glimpse_Videos")
}

fn settings_file_path() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("Glimpse").join("settings.json");
    }
    PathBuf::from("glimpse_settings.json")
}

fn apply_windows_startup(enabled: bool) -> Result<(), String> {
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_quoted = format!("\"{}\"", exe.display());
        let status = Command::new("reg")
            .args([
                "add",
                RUN_KEY,
                "/v",
                APP_VALUE_NAME,
                "/t",
                "REG_SZ",
                "/d",
                &exe_quoted,
                "/f",
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Impossible d'activer le démarrage automatique".to_string());
        }
    } else {
        let _ = Command::new("reg")
            .args(["delete", RUN_KEY, "/v", APP_VALUE_NAME, "/f"])
            .status();
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings() -> AppSettings {
    let path = settings_file_path();
    if let Ok(raw) = std::fs::read_to_string(&path)
        && let Ok(parsed) = serde_json::from_str::<AppSettings>(&raw)
    {
        return parsed;
    }
    AppSettings::default()
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<AppSettings, String> {
    let path = settings_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;

    apply_windows_startup(settings.launch_on_startup)?;
    Ok(settings)
}

#[tauri::command]
pub async fn pick_video_folder() -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choisir le dossier des vidéos")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(picked.map(|p| p.display().to_string()))
}

#[tauri::command]
pub fn open_videos_dir() -> Result<(), String> {
    let dir = effective_video_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Command::new("explorer")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
