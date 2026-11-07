use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct ThemeEntry {
    pub name: String,
    pub path: String,
    pub json: String,
}

static ALLOWED_FILE_PATHS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn allowed_paths_registry() -> &'static Mutex<HashSet<String>> {
    ALLOWED_FILE_PATHS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn normalize_path_key(path: &Path) -> String {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else if let Ok(cwd) = std::env::current_dir() {
        cwd.join(path)
    } else {
        path.to_path_buf()
    };
    let canonical = fs::canonicalize(&abs)
        .or_else(|error| match (abs.parent(), abs.file_name()) {
            (Some(parent), Some(name)) => fs::canonicalize(parent).map(|parent| parent.join(name)),
            _ => Err(error),
        })
        .unwrap_or(abs);
    canonical
        .to_string_lossy()
        .replace('/', "\\")
        .trim_start_matches("\\\\?\\")
        .to_lowercase()
}

/// Checks that a path does not target executable/script files or OS startup folders.
fn is_safe_document_path(path: &Path) -> Result<(), String> {
    let lower = path.to_string_lossy().replace('/', "\\").to_lowercase();
    if lower.contains("\\start menu\\programs\\startup") || lower.contains("\\startup\\") {
        return Err("Security policy: access to OS Startup directories is forbidden".to_string());
    }
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_lowercase();
        const BLOCKED_EXTS: &[&str] = &[
            "exe", "dll", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi",
            "scr", "com", "pif", "hta", "lnk", "reg", "sys", "drv",
        ];
        if BLOCKED_EXTS.contains(&ext_lower.as_str()) {
            return Err(format!(
                "Security policy: file extension '.{}' is blocked",
                ext_lower
            ));
        }
    }
    Ok(())
}

/// Grants capability access to a user-selected or CLI-specified document path.
pub fn authorize_user_file_path(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    is_safe_document_path(p)?;
    let key = normalize_path_key(p);
    if let Ok(mut guard) = allowed_paths_registry().lock() {
        guard.insert(key.clone());
    }
    Ok(key)
}

/// Verifies that a file path was explicitly authorized by the user (dialog, CLI, or saved session).
fn verify_authorized_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    is_safe_document_path(p)?;
    let key = normalize_path_key(p);
    if let Ok(guard) = allowed_paths_registry().lock() {
        if guard.contains(&key) {
            return Ok(());
        }
    }
    Err(format!(
        "Security policy: path '{}' has not been authorized via file dialog or CLI",
        path
    ))
}

/// Resolves the portable storage root for themes, session state, and WebView2 cache.
/// - Honours `LITEMD_DATA_DIR` if set.
/// - Uses `D:\projects\TextEditor` when present on the host machine (strictly preserving the D:\ rule).
/// - Falls back to `LOCALAPPDATA\LiteMD` / `HOME/.config/litemd` on machines without a D: drive.
pub fn get_storage_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("LITEMD_DATA_DIR") {
        let p = PathBuf::from(custom);
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    let d_workspace = Path::new("D:\\projects\\TextEditor");
    if d_workspace.exists() {
        return d_workspace.to_path_buf();
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local_app_data).join("LiteMD");
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        return PathBuf::from(home).join(".litemd");
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// Decodes a single legacy 8-bit byte using Windows-1255 (Hebrew) & Windows-1252 fallback tables.
#[inline]
fn decode_legacy_byte_cp1255(b: u8) -> char {
    match b {
        0x80 => '\u{20AC}', // €
        0x82 => '\u{201A}',
        0x83 => '\u{0192}',
        0x84 => '\u{201E}',
        0x85 => '\u{2026}',
        0x86 => '\u{2020}',
        0x87 => '\u{2021}',
        0x88 => '\u{02C6}',
        0x89 => '\u{2030}',
        0x8B => '\u{2039}',
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201C}',
        0x94 => '\u{201D}',
        0x95 => '\u{2022}',
        0x96 => '\u{2013}',
        0x97 => '\u{2014}',
        0x98 => '\u{02DC}',
        0x99 => '\u{2122}',
        0x9B => '\u{203A}',
        // Windows-1255 Hebrew points / niqqud (0xC0..=0xDF)
        0xC0..=0xC9 => char::from_u32(0x05B0 + (b - 0xC0) as u32).unwrap_or(b as char),
        0xCA => '\u{05BA}',
        0xCB..=0xCF => char::from_u32(0x05BB + (b - 0xCB) as u32).unwrap_or(b as char),
        0xD0 => '\u{05C0}',
        0xD1 => '\u{05C1}',
        0xD2 => '\u{05C2}',
        0xD3 => '\u{05C3}',
        0xD4 => '\u{05F0}',
        0xD5 => '\u{05F1}',
        0xD6 => '\u{05F2}',
        0xD7 => '\u{05F3}',
        0xD8 => '\u{05F4}',
        // Windows-1255 Hebrew letters Alef..Tav (0xE0..=0xFA -> U+05D0..=U+05EA)
        0xE0..=0xFA => char::from_u32(0x05D0 + (b - 0xE0) as u32).unwrap_or(b as char),
        0xFD => '\u{200E}', // LRM
        0xFE => '\u{200F}', // RLM
        _ => b as char,
    }
}

/// Decodes raw file bytes into a Rust `String`.
/// - Zero-allocation fast path for valid UTF-8 (with or without BOM).
/// - Supports UTF-16 LE and UTF-16 BE with BOM.
/// - Automatically falls back to Windows-1255 (Hebrew) / Windows-1252 for legacy 8-bit files.
pub fn decode_text_bytes(bytes: Vec<u8>) -> String {
    // 1. Check UTF-16 LE BOM (FF FE)
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u16s);
    }
    // 2. Check UTF-16 BE BOM (FE FF)
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u16s);
    }
    // 3. Fast zero-copy path for valid UTF-8
    match String::from_utf8(bytes) {
        Ok(mut s) => {
            if s.starts_with('\u{feff}') {
                s.drain(..'\u{feff}'.len_utf8());
            }
            s
        }
        Err(err) => {
            // 4. Legacy 8-bit fallback (Windows-1255 Hebrew / Windows-1252)
            let raw = err.into_bytes();
            let mut decoded = String::with_capacity(raw.len() * 2);
            for b in raw {
                decoded.push(decode_legacy_byte_cp1255(b));
            }
            decoded
        }
    }
}

#[inline]
fn extract_mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pre-allocates exact file length and performs a single contiguous read on an authorized path.
#[tauri::command]
fn read_markdown_file(path: &str) -> Result<String, String> {
    verify_authorized_path(path)?;
    let target = Path::new(path);
    let meta = fs::metadata(target).map_err(|e| format!("Failed to stat '{}': {}", path, e))?;
    let cap = (meta.len() as usize).saturating_add(16);

    let mut file = File::open(target).map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    let mut raw_bytes = Vec::with_capacity(cap);
    file.read_to_end(&mut raw_bytes)
        .map_err(|e| format!("Failed to read '{}': {}", path, e))?;

    Ok(decode_text_bytes(raw_bytes))
}

static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

/// A failed replacement must leave the original intact; never fall back to truncating it.
fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let temp = target.with_file_name(format!(
        ".{}.{}.{}.litemd.tmp",
        name,
        std::process::id(),
        NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| format!("Failed to create temporary file: {}", e))?;
    let result = (|| {
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("Failed to flush temporary file: {}", e))?;
        drop(file);
        fs::rename(&temp, target).map_err(|e| {
            format!(
                "Failed to replace '{}'; original preserved: {}",
                target.display(),
                e
            )
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Atomically writes bytes to a sibling temp file and renames over target, returning the new mtime (ms).
#[tauri::command]
fn save_markdown_file(path: &str, content: &str) -> Result<u64, String> {
    verify_authorized_path(path)?;
    let target = Path::new(path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }
    atomic_write(target, content.as_bytes())?;
    Ok(extract_mtime_ms(target))
}

/// Returns the first non-flag file argument passed via CLI (`litemd notes.md`) or Windows "Open With".
#[tauri::command]
fn get_cli_file_arg() -> Option<String> {
    let mut args = std::env::args_os();
    let _exe = args.next(); // Skip argv[0]

    for arg in args {
        let s = arg.to_string_lossy();
        let trimmed = s.trim();
        if trimmed.is_empty() || trimmed.starts_with('-') {
            continue;
        }
        let candidate = Path::new(trimmed);
        let resolved: PathBuf = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else if let Ok(cwd) = std::env::current_dir() {
            cwd.join(candidate)
        } else {
            candidate.to_path_buf()
        };
        let resolved_str = resolved.to_string_lossy().into_owned();
        if authorize_user_file_path(&resolved_str).is_ok() {
            return Some(resolved_str);
        }
    }
    None
}

/// Lightweight file modification timestamp probe for zero-bloat external change detection.
#[tauri::command]
fn get_file_mtime(path: &str) -> Result<u64, String> {
    verify_authorized_path(path)?;
    let target = Path::new(path);
    if !target.exists() {
        return Err("File does not exist".to_string());
    }
    Ok(extract_mtime_ms(target))
}

#[cfg(target_os = "windows")]
mod win32_dialog {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::ptr;

    #[repr(C)]
    struct OPENFILENAMEW {
        l_struct_size: u32,
        hwnd_owner: usize,
        h_instance: usize,
        lpstr_filter: *const u16,
        lpstr_custom_filter: *mut u16,
        n_max_cust_filter: u32,
        n_filter_index: u32,
        lpstr_file: *mut u16,
        n_max_file: u32,
        lpstr_file_title: *mut u16,
        n_max_file_title: u32,
        lpstr_initial_dir: *const u16,
        lpstr_title: *const u16,
        flags: u32,
        n_file_offset: u16,
        n_file_extension: u16,
        lpstr_def_ext: *const u16,
        l_cust_data: usize,
        lpfn_hook: usize,
        lp_template_name: *const u16,
        pv_reserved: *mut core::ffi::c_void,
        dw_reserved: u32,
        flags_ex: u32,
    }

    const OFN_EXPLORER: u32 = 0x00080000;
    const OFN_FILEMUSTEXIST: u32 = 0x00001000;
    const OFN_PATHMUSTEXIST: u32 = 0x00000800;
    const OFN_OVERWRITEPROMPT: u32 = 0x00000002;
    const OFN_NOCHANGEDIR: u32 = 0x00000008;

    #[link(name = "comdlg32")]
    extern "system" {
        fn GetOpenFileNameW(lpofn: *mut OPENFILENAMEW) -> i32;
        fn GetSaveFileNameW(lpofn: *mut OPENFILENAMEW) -> i32;
    }

    fn to_wide_null(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    pub fn open_dialog(
        filter_spec: &[u16],
        title: &str,
        initial_dir: Option<&str>,
    ) -> Option<String> {
        let mut file_buf = vec![0u16; 1024];
        let title_w = to_wide_null(title);
        let init_dir_w = initial_dir.map(to_wide_null);
        let def_ext_w = to_wide_null("md");

        let mut ofn = OPENFILENAMEW {
            l_struct_size: core::mem::size_of::<OPENFILENAMEW>() as u32,
            hwnd_owner: 0,
            h_instance: 0,
            lpstr_filter: filter_spec.as_ptr(),
            lpstr_custom_filter: ptr::null_mut(),
            n_max_cust_filter: 0,
            n_filter_index: 1,
            lpstr_file: file_buf.as_mut_ptr(),
            n_max_file: file_buf.len() as u32,
            lpstr_file_title: ptr::null_mut(),
            n_max_file_title: 0,
            lpstr_initial_dir: init_dir_w.as_ref().map_or(ptr::null(), |v| v.as_ptr()),
            lpstr_title: title_w.as_ptr(),
            flags: OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
            n_file_offset: 0,
            n_file_extension: 0,
            lpstr_def_ext: def_ext_w.as_ptr(),
            l_cust_data: 0,
            lpfn_hook: 0,
            lp_template_name: ptr::null(),
            pv_reserved: ptr::null_mut(),
            dw_reserved: 0,
            flags_ex: 0,
        };

        let ok = unsafe { GetOpenFileNameW(&mut ofn) };
        if ok != 0 {
            let end = file_buf
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(file_buf.len());
            Some(
                OsString::from_wide(&file_buf[..end])
                    .to_string_lossy()
                    .into_owned(),
            )
        } else {
            None
        }
    }

    pub fn save_dialog(
        filter_spec: &[u16],
        title: &str,
        default_path: Option<&str>,
        initial_dir: Option<&str>,
        def_ext: &str,
    ) -> Option<String> {
        let mut file_buf = vec![0u16; 1024];
        if let Some(dp) = default_path {
            let wide: Vec<u16> = std::ffi::OsStr::new(dp).encode_wide().collect();
            let copy_len = wide.len().min(file_buf.len() - 1);
            file_buf[..copy_len].copy_from_slice(&wide[..copy_len]);
        }
        let title_w = to_wide_null(title);
        let init_dir_w = initial_dir.map(to_wide_null);
        let def_ext_w = to_wide_null(def_ext);

        let mut ofn = OPENFILENAMEW {
            l_struct_size: core::mem::size_of::<OPENFILENAMEW>() as u32,
            hwnd_owner: 0,
            h_instance: 0,
            lpstr_filter: filter_spec.as_ptr(),
            lpstr_custom_filter: ptr::null_mut(),
            n_max_cust_filter: 0,
            n_filter_index: 1,
            lpstr_file: file_buf.as_mut_ptr(),
            n_max_file: file_buf.len() as u32,
            lpstr_file_title: ptr::null_mut(),
            n_max_file_title: 0,
            lpstr_initial_dir: init_dir_w.as_ref().map_or(ptr::null(), |v| v.as_ptr()),
            lpstr_title: title_w.as_ptr(),
            flags: OFN_EXPLORER | OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR,
            n_file_offset: 0,
            n_file_extension: 0,
            lpstr_def_ext: def_ext_w.as_ptr(),
            l_cust_data: 0,
            lpfn_hook: 0,
            lp_template_name: ptr::null(),
            pv_reserved: ptr::null_mut(),
            dw_reserved: 0,
            flags_ex: 0,
        };

        let ok = unsafe { GetSaveFileNameW(&mut ofn) };
        if ok != 0 {
            let end = file_buf
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(file_buf.len());
            Some(
                OsString::from_wide(&file_buf[..end])
                    .to_string_lossy()
                    .into_owned(),
            )
        } else {
            None
        }
    }

    pub fn md_filter() -> Vec<u16> {
        let raw = "Markdown Documents (*.md;*.markdown;*.txt)\0*.md;*.markdown;*.txt\0All Files (*.*)\0*.*\0\0";
        raw.encode_utf16().collect()
    }
}

#[tauri::command]
fn pick_open_markdown_file(initial_dir: Option<&str>) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let root_str = get_storage_root().to_string_lossy().into_owned();
        let filter = win32_dialog::md_filter();
        let chosen = win32_dialog::open_dialog(
            &filter,
            "Open Markdown Document — LiteMD",
            initial_dir.or(Some(root_str.as_str())),
        );
        if let Some(ref p) = chosen {
            authorize_user_file_path(p)?;
        }
        Ok(chosen)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = initial_dir;
        Ok(None)
    }
}

#[tauri::command]
fn pick_save_markdown_file(default_path: Option<&str>) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let root_str = get_storage_root().to_string_lossy().into_owned();
        let filter = win32_dialog::md_filter();
        let chosen = win32_dialog::save_dialog(
            &filter,
            "Save Markdown Document — LiteMD",
            default_path,
            Some(root_str.as_str()),
            "md",
        );
        if let Some(ref p) = chosen {
            authorize_user_file_path(p)?;
        }
        Ok(chosen)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = default_path;
        Ok(None)
    }
}

/// Saves custom user theme JSON inside `<storage_root>/themes/`.
#[tauri::command]
fn save_custom_theme_json(name: &str, json_content: &str) -> Result<String, String> {
    let themes_dir = get_storage_root().join("themes");
    if !themes_dir.exists() {
        fs::create_dir_all(&themes_dir)
            .map_err(|e| format!("Failed to create themes directory: {}", e))?;
    }
    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let filename = if safe_name.is_empty() {
        "custom_theme.json".to_string()
    } else {
        format!("{}.json", safe_name)
    };
    let full_path = themes_dir.join(filename);
    fs::write(&full_path, json_content.as_bytes())
        .map_err(|e| format!("Failed to save theme: {}", e))?;
    Ok(full_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_custom_themes() -> Result<Vec<ThemeEntry>, String> {
    let themes_dir = get_storage_root().join("themes");
    if !themes_dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let rd = fs::read_dir(&themes_dir).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(json) = fs::read_to_string(&path) {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("custom")
                    .to_string();
                entries.push(ThemeEntry {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    json,
                });
            }
        }
    }
    Ok(entries)
}

fn authorize_paths_from_session_json(session_json: &str) {
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(session_json) {
        if let Some(tabs) = val.get("tabs").and_then(|t| t.as_array()) {
            for tab in tabs {
                if let Some(fp) = tab.get("filePath").and_then(|p| p.as_str()) {
                    let _ = authorize_user_file_path(fp);
                }
            }
        }
    }
}

/// Atomically persists the active multi-tab session (including unsaved buffers)
/// inside `<storage_root>/.cache/session.json`.
#[tauri::command]
fn save_session_state(session_json: &str) -> Result<(), String> {
    // A frontend-written session must not become a way to grant itself new file capabilities.
    let session: serde_json::Value =
        serde_json::from_str(session_json).map_err(|e| e.to_string())?;
    if let Some(tabs) = session.get("tabs").and_then(|value| value.as_array()) {
        for tab in tabs {
            if let Some(path) = tab.get("filePath").and_then(|value| value.as_str()) {
                verify_authorized_path(path)?;
            }
        }
    }
    let cache_dir = get_storage_root().join(".cache");
    if !cache_dir.exists() {
        fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }
    let final_path = cache_dir.join("session.json");
    atomic_write(&final_path, session_json.as_bytes())?;
    Ok(())
}

/// Loads the persisted multi-tab session from `<storage_root>/.cache/session.json`.
#[tauri::command]
fn load_session_state() -> Result<Option<String>, String> {
    let final_path = get_storage_root().join(".cache").join("session.json");
    if !final_path.exists() {
        return Ok(None);
    }
    match fs::read_to_string(final_path) {
        Ok(s) if !s.trim().is_empty() => {
            authorize_paths_from_session_json(&s);
            Ok(Some(s))
        }
        _ => Ok(None),
    }
}

/// Safely opens an external `https://`, `http://`, or `mailto:` URL in the user's default OS browser
/// so clicking a link inside the Markdown preview never navigates the LiteMD window itself.
#[tauri::command]
fn open_external_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    let lower = trimmed.to_lowercase();
    if !(lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:"))
    {
        return Err(
            "Security policy: only http(s) and mailto URLs may be opened externally".to_string(),
        );
    }
    if trimmed.chars().any(|c| c.is_control() || c == '"') {
        return Err("Security policy: URL contains unsafe characters".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: usize,
                operation: *const u16,
                file: *const u16,
                parameters: *const u16,
                directory: *const u16,
                show: i32,
            ) -> isize;
        }
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let wide_url: Vec<u16> = std::ffi::OsStr::new(trimmed)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                0,
                operation.as_ptr(),
                wide_url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result <= 32 {
            return Err(format!(
                "Failed to open URL in the default application ({}).",
                result
            ));
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let storage_root = get_storage_root();
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        let wv2_dir = storage_root.join(".cache").join("webview2");
        let _ = fs::create_dir_all(&wv2_dir);
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", wv2_dir);
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            save_markdown_file,
            get_cli_file_arg,
            get_file_mtime,
            pick_open_markdown_file,
            pick_save_markdown_file,
            save_custom_theme_json,
            list_custom_themes,
            save_session_state,
            load_session_state,
            open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("fatal error while running LiteMD Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_and_save_markdown_file_atomic() {
        let tmp_dir = get_storage_root().join(".cache").join("tmp");
        let _ = fs::create_dir_all(&tmp_dir);
        let test_path_buf = tmp_dir.join("rust_io_test.md");
        let test_path = test_path_buf.to_str().unwrap();

        // Unauthorized read/write must be rejected first
        assert!(save_markdown_file(test_path, "blocked").is_err());

        // Authorize via capability registry
        authorize_user_file_path(test_path).expect("authorization should succeed");

        let sample = "# Test Heading\n\nInline math $x_1 + x_2 = y$ and matrix:\n$$\n\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}\n$$\n";
        let mtime = save_markdown_file(test_path, sample).expect("atomic save should succeed");
        assert!(mtime > 0);

        let loaded = read_markdown_file(test_path).expect("read should succeed");
        assert_eq!(loaded, sample);

        let stat_mtime = get_file_mtime(test_path).expect("mtime check should succeed");
        assert!(stat_mtime >= mtime);
        save_markdown_file(test_path, "replacement")
            .expect("existing file replacement should succeed");
        assert_eq!(read_markdown_file(test_path).unwrap(), "replacement");
        let _ = std::fs::remove_file(test_path);
    }

    #[test]
    fn test_failed_atomic_replace_preserves_original() {
        let dir = get_storage_root()
            .join(".cache")
            .join("tmp")
            .join("atomic-failure-test");
        fs::create_dir_all(&dir).unwrap();
        let original = dir.join("original.md");
        fs::write(&original, "keep me").unwrap();
        // Replacing a directory with a file must fail without touching its contents.
        assert!(atomic_write(&dir, b"replacement").is_err());
        assert_eq!(fs::read_to_string(&original).unwrap(), "keep me");
        fs::remove_file(original).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn test_session_cannot_authorize_unselected_file() {
        let path = get_storage_root().join("unselected-session-file.md");
        let path_str = path.to_str().unwrap();
        assert!(verify_authorized_path(path_str).is_err());
        let forged =
            serde_json::json!({"version": 1, "tabs": [{"filePath": path_str}]}).to_string();
        assert!(save_session_state(&forged).is_err());
        assert!(verify_authorized_path(path_str).is_err());
    }

    #[test]
    fn test_new_file_capability_survives_creation_with_dot_parent() {
        let dir = get_storage_root().join(".cache").join("tmp");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(".").join("new-capability.md");
        let path_str = path.to_str().unwrap();
        authorize_user_file_path(path_str).unwrap();
        save_markdown_file(path_str, "first save").unwrap();
        save_markdown_file(path_str, "second save").unwrap();
        assert_eq!(read_markdown_file(path_str).unwrap(), "second save");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn test_security_blocks_executables_and_startup_folder() {
        assert!(authorize_user_file_path("C:\\Users\\Public\\evil.exe").is_err());
        assert!(authorize_user_file_path("C:\\Users\\Public\\script.bat").is_err());
        assert!(authorize_user_file_path("C:\\Users\\Public\\payload.ps1").is_err());
        assert!(authorize_user_file_path(
            "C:\\Users\\User\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\note.md"
        )
        .is_err());
        assert!(open_external_url("javascript:alert(1)").is_err());
        assert!(open_external_url("file:///C:/Windows/System32/calc.exe").is_err());
    }

    #[test]
    fn test_windows_1255_hebrew_and_utf16_decoding() {
        // Windows-1255 bytes for "שלום" (Shin=0xF9, Lamed=0xEC, Vav=0xE5, Final Mem=0xED)
        let cp1255_bytes = vec![0xF9, 0xEC, 0xE5, 0xED];
        let decoded = decode_text_bytes(cp1255_bytes);
        assert_eq!(decoded, "שלום");

        // UTF-16 LE BOM + "אב" (U+05D0, U+05D1)
        let utf16le_bytes = vec![0xFF, 0xFE, 0xD0, 0x05, 0xD1, 0x05];
        let decoded16 = decode_text_bytes(utf16le_bytes);
        assert_eq!(decoded16, "אב");
    }

    #[test]
    fn test_save_and_list_custom_themes() {
        let theme_json = r#"{"id":"unit-test-theme","name":"Unit Test Theme"}"#;
        let saved_path = save_custom_theme_json("unit-test-theme", theme_json)
            .expect("saving custom theme should succeed");

        let themes = list_custom_themes().expect("listing custom themes should succeed");
        assert!(themes.iter().any(|t| t.name == "unit-test-theme"));
        let _ = std::fs::remove_file(saved_path);
    }
}
