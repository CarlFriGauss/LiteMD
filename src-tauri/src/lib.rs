use serde::Serialize;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct ThemeEntry {
    pub name: String,
    pub path: String,
    pub json: String,
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

/// Pre-allocates exact file length and performs a single contiguous read.
#[tauri::command]
fn read_markdown_file(path: &str) -> Result<String, String> {
    let target = Path::new(path);
    let meta = fs::metadata(target).map_err(|e| format!("Failed to stat '{}': {}", path, e))?;
    let cap = (meta.len() as usize).saturating_add(16);

    let mut file = File::open(target).map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    let mut buf = String::with_capacity(cap);
    file.read_to_string(&mut buf)
        .map_err(|e| format!("Failed to read UTF-8 text from '{}': {}", path, e))?;

    // Strip UTF-8 BOM in-place without reallocating a new String
    if buf.starts_with('\u{feff}') {
        buf.drain(..'\u{feff}'.len_utf8());
    }
    Ok(buf)
}

/// Writes raw bytes directly to disk and returns the new modification timestamp (ms).
#[tauri::command]
fn save_markdown_file(path: &str, content: &str) -> Result<u64, String> {
    let target = Path::new(path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }
    fs::write(target, content.as_bytes())
        .map_err(|e| format!("Failed to write '{}': {}", path, e))?;
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
        return Some(resolved.to_string_lossy().into_owned());
    }
    None
}

/// Lightweight file modification timestamp probe for zero-bloat external change detection.
#[tauri::command]
fn get_file_mtime(path: &str) -> Result<u64, String> {
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

    pub fn open_dialog(filter_spec: &[u16], title: &str, initial_dir: Option<&str>) -> Option<String> {
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
            let end = file_buf.iter().position(|&c| c == 0).unwrap_or(file_buf.len());
            Some(OsString::from_wide(&file_buf[..end]).to_string_lossy().into_owned())
        } else {
            None
        }
    }

    pub fn save_dialog(
        filter_spec: &[u16],
        title: &str,
        default_path: Option<&str>,
        def_ext: &str,
    ) -> Option<String> {
        let mut file_buf = vec![0u16; 1024];
        if let Some(dp) = default_path {
            let wide: Vec<u16> = std::ffi::OsStr::new(dp).encode_wide().collect();
            let copy_len = wide.len().min(file_buf.len() - 1);
            file_buf[..copy_len].copy_from_slice(&wide[..copy_len]);
        }
        let title_w = to_wide_null(title);
        let init_dir_w = Some(to_wide_null("D:\\projects\\TextEditor"));
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
            let end = file_buf.iter().position(|&c| c == 0).unwrap_or(file_buf.len());
            Some(OsString::from_wide(&file_buf[..end]).to_string_lossy().into_owned())
        } else {
            None
        }
    }

    pub fn md_filter() -> Vec<u16> {
        let raw = "Markdown Documents (*.md;*.markdown)\0*.md;*.markdown\0All Files (*.*)\0*.*\0\0";
        raw.encode_utf16().collect()
    }
}

#[tauri::command]
fn pick_open_markdown_file(initial_dir: Option<&str>) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let filter = win32_dialog::md_filter();
        Ok(win32_dialog::open_dialog(
            &filter,
            "Open Markdown Document — LiteMD",
            initial_dir.or(Some("D:\\projects\\TextEditor")),
        ))
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
        let filter = win32_dialog::md_filter();
        Ok(win32_dialog::save_dialog(
            &filter,
            "Save Markdown Document — LiteMD",
            default_path,
            "md",
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = default_path;
        Ok(None)
    }
}

/// Saves custom user theme JSON strictly onto the D:\ drive (`D:\projects\TextEditor\themes\`).
#[tauri::command]
fn save_custom_theme_json(name: &str, json_content: &str) -> Result<String, String> {
    let themes_dir = Path::new("D:\\projects\\TextEditor\\themes");
    if !themes_dir.exists() {
        fs::create_dir_all(themes_dir)
            .map_err(|e| format!("Failed to create D:\\ themes directory: {}", e))?;
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
        .map_err(|e| format!("Failed to save theme on D:\\: {}", e))?;
    Ok(full_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_custom_themes() -> Result<Vec<ThemeEntry>, String> {
    let themes_dir = Path::new("D:\\projects\\TextEditor\\themes");
    if !themes_dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let rd = fs::read_dir(themes_dir).map_err(|e| e.to_string())?;
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

/// Atomically persists the active multi-tab session (including unsaved buffers)
/// strictly on D:\ (`D:\projects\TextEditor\.cache\session.json`).
#[tauri::command]
fn save_session_state(session_json: &str) -> Result<(), String> {
    let cache_dir = Path::new("D:\\projects\\TextEditor\\.cache");
    if !cache_dir.exists() {
        fs::create_dir_all(cache_dir)
            .map_err(|e| format!("Failed to create D:\\ cache directory: {}", e))?;
    }
    let tmp_path = cache_dir.join("session.json.tmp");
    let final_path = cache_dir.join("session.json");
    fs::write(&tmp_path, session_json.as_bytes())
        .map_err(|e| format!("Failed to write session temp file on D:\\: {}", e))?;
    fs::rename(&tmp_path, &final_path)
        .or_else(|_| fs::write(&final_path, session_json.as_bytes()))
        .map_err(|e| format!("Failed to commit session file on D:\\: {}", e))?;
    Ok(())
}

/// Loads the persisted multi-tab session from `D:\projects\TextEditor\.cache\session.json`.
#[tauri::command]
fn load_session_state() -> Result<Option<String>, String> {
    let final_path = Path::new("D:\\projects\\TextEditor\\.cache\\session.json");
    if !final_path.exists() {
        return Ok(None);
    }
    match fs::read_to_string(final_path) {
        Ok(s) if !s.trim().is_empty() => Ok(Some(s)),
        _ => Ok(None),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        let wv2_dir = Path::new("D:\\projects\\TextEditor\\.cache\\webview2");
        let _ = fs::create_dir_all(wv2_dir);
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
        ])
        .run(tauri::generate_context!())
        .expect("fatal error while running LiteMD Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_and_save_markdown_file_on_d_drive() {
        let test_path = "D:\\projects\\TextEditor\\.cache\\tmp\\rust_io_test.md";
        let sample = "# Test Heading\n\nInline math $x_1 + x_2 = y$ and matrix:\n$$\n\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}\n$$\n";
        let mtime = save_markdown_file(test_path, sample).expect("save should succeed on D:\\");
        assert!(mtime > 0);

        let loaded = read_markdown_file(test_path).expect("read should succeed on D:\\");
        assert_eq!(loaded, sample);

        let stat_mtime = get_file_mtime(test_path).expect("mtime check should succeed");
        assert!(stat_mtime >= mtime);
        let _ = std::fs::remove_file(test_path);
    }

    #[test]
    fn test_save_and_list_custom_themes_on_d_drive() {
        let theme_json = r#"{"id":"unit-test-theme","name":"Unit Test Theme"}"#;
        let saved_path = save_custom_theme_json("unit-test-theme", theme_json)
            .expect("saving custom theme on D:\\ should succeed");
        assert!(saved_path.starts_with("D:\\projects\\TextEditor\\themes\\"));

        let themes = list_custom_themes().expect("listing custom themes should succeed");
        assert!(themes.iter().any(|t| t.name == "unit-test-theme"));
        let _ = std::fs::remove_file(saved_path);
    }
}

