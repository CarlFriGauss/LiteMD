//! Read-only image capabilities. No directory scope, server, image decoder, or byte IPC.
use super::verify_authorized_path;
use serde::Serialize;
use std::collections::{hash_map::RandomState, HashMap};
use std::fs::{self, File};
use std::hash::BuildHasher;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::http::{Request, Response};

const MAX_REFERENCES: usize = 512;
const MAX_IMAGES: usize = 2048;
const MAX_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone)]
struct Image {
    key: String,
    source: PathBuf,
    canonical: PathBuf,
    root: PathBuf,
    mime: &'static str,
}
#[derive(Default)]
struct Registry {
    documents: HashMap<String, HashMap<String, Arc<Image>>>,
    images: HashMap<String, Arc<Image>>,
    random: RandomState,
    sequence: u64,
}
static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}
#[derive(Serialize)]
pub struct Resolution {
    reference: String,
    key: Option<String>,
    version: String,
    error: Option<String>,
}
fn mime(path: &Path) -> Result<&'static str, String> {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "svg" => Ok("image/svg+xml"),
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "gif" => Ok("image/gif"),
        "webp" => Ok("image/webp"),
        _ => Err("Unsupported image format".into()),
    }
}
fn candidate(root: &Path, reference: &str) -> Result<PathBuf, String> {
    if reference.is_empty()
        || reference.len() > 2048
        || reference
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '?' | '*' | '<' | '>' | '|'))
    {
        return Err("Invalid relative image path".into());
    }
    let relative = Path::new(reference);
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err("Images must remain inside the document folder".into());
    }
    Ok(root.join(relative))
}
// Check the opened handle, not only a pre-open path: a replaced junction must not escape.
#[cfg(windows)]
fn final_path(file: &File) -> Result<PathBuf, String> {
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFinalPathNameByHandleW(
            handle: *mut std::ffi::c_void,
            buffer: *mut u16,
            length: u32,
            flags: u32,
        ) -> u32;
    }
    let mut buffer = vec![0u16; 512];
    let mut length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    };
    if length as usize >= buffer.len() {
        buffer.resize(length as usize + 1, 0);
        length = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        };
    }
    if length == 0 || length as usize >= buffer.len() {
        return Err("Cannot validate image handle".into());
    }
    Ok(PathBuf::from(std::ffi::OsString::from_wide(
        &buffer[..length as usize],
    )))
}
#[cfg(not(windows))]
fn final_path(file: &File) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        fs::canonicalize(format!("/proc/self/fd/{}", file.as_raw_fd())).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = file;
        Err("Local image handle validation is unavailable on this platform".into())
    }
}
fn open_image(image: &Image) -> Result<(File, String, u64), String> {
    let mut file = File::open(&image.source).map_err(|_| "Image is unavailable")?;
    let actual = final_path(&file)?;
    let key = |path: &Path| {
        path.to_string_lossy()
            .replace('/', "\\")
            .trim_start_matches("\\\\?\\")
            .to_lowercase()
    };
    if !actual.starts_with(&image.root) || key(&actual) != key(&image.canonical) {
        return Err("Image path changed or escaped its document folder".into());
    }
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return Err("Image exceeds the 32 MiB limit".into());
    }
    let mut prefix = [0u8; 4096];
    let count = file.read(&mut prefix).map_err(|e| e.to_string())?;
    let bytes = &prefix[..count];
    let valid = match image.mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        "image/svg+xml" => bytes.windows(4).any(|s| s == b"<svg"),
        _ => false,
    };
    if !valid {
        return Err("File does not match its image format".into());
    }
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Ok((file, format!("{modified:x}-{:x}", meta.len()), meta.len()))
}
fn resolve(
    owner: &str,
    document_path: &str,
    references: Vec<String>,
) -> Result<Vec<Resolution>, String> {
    if owner.is_empty()
        || owner.len() > 48
        || !owner
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid document image owner".into());
    }
    if references.len() > MAX_REFERENCES {
        return Err("At most 512 local image references per document".into());
    }
    verify_authorized_path(document_path)?;
    let document = Path::new(document_path);
    if !document.is_absolute() || !document.is_file() {
        return Err("Save or open the document before loading local images".into());
    }
    let root = fs::canonicalize(document.parent().ok_or("Document folder is unavailable")?)
        .map_err(|e| e.to_string())?;
    let old = registry()
        .lock()
        .map_err(|e| e.to_string())?
        .documents
        .get(owner)
        .cloned()
        .unwrap_or_default();
    let mut next = HashMap::new();
    let mut results = Vec::with_capacity(references.len());
    for reference in references {
        if next.contains_key(&reference) {
            continue;
        }
        let result = (|| {
            let source = candidate(&root, &reference)?;
            let canonical = fs::canonicalize(&source).map_err(|_| "Image is unavailable")?;
            if !canonical.starts_with(&root) {
                return Err("Image escapes its document folder".into());
            }
            let content_type = mime(&canonical)?;
            let image = if let Some(previous) = old
                .get(&reference)
                .filter(|v| v.canonical == canonical && v.root == root)
            {
                previous.clone()
            } else {
                let mut state = registry().lock().map_err(|e| e.to_string())?;
                state.sequence += 1;
                let key = format!(
                    "{:016x}{:016x}",
                    state.sequence,
                    state.random.hash_one((state.sequence, owner, &canonical))
                );
                Arc::new(Image {
                    key,
                    source,
                    canonical,
                    root: root.clone(),
                    mime: content_type,
                })
            };
            let (_, version, _) = open_image(&image)?;
            Ok::<_, String>((image, version))
        })();
        match result {
            Ok((image, version)) => {
                results.push(Resolution {
                    reference: reference.clone(),
                    key: Some(image.key.clone()),
                    version,
                    error: None,
                });
                next.insert(reference, image);
            }
            Err(error) => results.push(Resolution {
                reference,
                key: None,
                version: String::new(),
                error: Some(error),
            }),
        }
    }
    let mut state = registry().lock().map_err(|e| e.to_string())?;
    let previous_count = state.documents.get(owner).map_or(0, |images| images.len());
    if state.images.len() - previous_count + next.len() > MAX_IMAGES {
        return Err("Local image capability limit reached".into());
    }
    if let Some(previous) = state.documents.remove(owner) {
        for image in previous.values() {
            state.images.remove(&image.key);
        }
    }
    for image in next.values() {
        state.images.insert(image.key.clone(), image.clone());
    }
    if next.is_empty() {
        state.documents.remove(owner);
    } else {
        state.documents.insert(owner.to_owned(), next);
    }
    Ok(results)
}
#[tauri::command]
pub async fn sync_document_images(
    owner: String,
    document_path: String,
    references: Vec<String>,
) -> Result<Vec<Resolution>, String> {
    tauri::async_runtime::spawn_blocking(move || resolve(&owner, &document_path, references))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn release_document_images(owner: &str) {
    if let Some(state) = REGISTRY.get() {
        if let Ok(mut state) = state.lock() {
            if let Some(images) = state.documents.remove(owner) {
                for image in images.values() {
                    state.images.remove(&image.key);
                }
            }
        }
    }
}
pub fn respond(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let response = || -> Result<Response<Vec<u8>>, String> {
        if request.method() != "GET" && request.method() != "HEAD" {
            return Err("Unsupported method".into());
        }
        let key = request.uri().path().trim_start_matches('/');
        if key.len() != 32 || !key.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid image key".into());
        }
        let image = REGISTRY
            .get()
            .and_then(|r| r.lock().ok()?.images.get(key).cloned())
            .ok_or("Image capability has expired")?;
        let (file, version, length) = open_image(&image)?;
        let etag = format!("W/\"{version}\"");
        let builder = Response::builder()
            .header("Content-Type", image.mime)
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "private, max-age=0, must-revalidate")
            .header(
                "Content-Security-Policy",
                "sandbox; default-src 'none'; style-src 'unsafe-inline'",
            )
            .header("ETag", &etag);
        if request
            .headers()
            .get("if-none-match")
            .and_then(|h| h.to_str().ok())
            == Some(etag.as_str())
        {
            return builder
                .status(304)
                .body(Vec::new())
                .map_err(|e| e.to_string());
        }
        let mut bytes = Vec::with_capacity(if request.method() == "HEAD" {
            0
        } else {
            length as usize
        });
        if request.method() != "HEAD" {
            file.take(MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 > MAX_BYTES {
                return Err("Image is too large".into());
            }
        }
        builder.body(bytes).map_err(|e| e.to_string())
    };
    response().unwrap_or_else(|_| {
        Response::builder()
            .status(404)
            .header("Cache-Control", "no-store")
            .body(Vec::new())
            .unwrap()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn fixture() -> (PathBuf, String) {
        let root = super::super::get_storage_root()
            .join(".cache")
            .join("image-tests")
            .join(format!(
                "{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir_all(root.join("figures")).unwrap();
        let document = root.join("document.md");
        fs::write(&document, "# Test").unwrap();
        let path = document.to_string_lossy().into_owned();
        super::super::authorize_user_file_path(&path).unwrap();
        (root, path)
    }
    fn request(key: &str) -> Request<Vec<u8>> {
        Request::builder()
            .uri(format!("http://litemd-image.localhost/{key}"))
            .body(Vec::new())
            .unwrap()
    }
    #[test]
    fn images_are_exact_revocable_capabilities_and_reopenable() {
        let (root, path) = fixture();
        fs::write(
            root.join("figures/plot.svg"),
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
        )
        .unwrap();
        let first = resolve("image-test-a", &path, vec!["figures/plot.svg".into()]).unwrap();
        let key = first[0].key.as_ref().unwrap();
        assert_eq!(respond(request(key)).status(), 200);
        assert_eq!(
            respond(request(key)).headers()["content-type"],
            "image/svg+xml"
        );
        let other = resolve("image-test-b", &path, vec!["figures/plot.svg".into()]).unwrap();
        release_document_images("image-test-a");
        assert_eq!(respond(request(key)).status(), 404);
        assert_eq!(
            respond(request(other[0].key.as_ref().unwrap())).status(),
            200
        );
        let reopened = resolve("image-test-a", &path, vec!["figures/plot.svg".into()]).unwrap();
        assert_eq!(
            respond(request(reopened[0].key.as_ref().unwrap())).status(),
            200
        );
        resolve("image-test-a", &path, vec![]).unwrap();
        assert_eq!(
            respond(request(reopened[0].key.as_ref().unwrap())).status(),
            404
        );
        release_document_images("image-test-b");
    }
    #[test]
    fn image_authorization_rejects_traversal_absolute_paths_and_wrong_formats() {
        let (root, path) = fixture();
        fs::write(root.join("secret.png"), "not an image").unwrap();
        let refs = vec![
            "../outside.svg",
            "C:\\private.svg",
            "\\\\server\\private.svg",
            "secret.png",
            "document.md",
            "a.svg:stream",
            "missing.svg",
        ];
        let result = resolve(
            "image-test-reject",
            &path,
            refs.into_iter().map(String::from).collect(),
        )
        .unwrap();
        assert!(result.iter().all(|r| r.key.is_none()));
        assert!(resolve(
            "image-test-reject",
            "D:\\not-authorized.md",
            vec!["x.svg".into()]
        )
        .is_err());
    }
    #[test]
    fn image_paths_support_spaces_unicode_and_native_formats() {
        let (root, path) = fixture();
        for (name, bytes) in [
            ("figures/plot space.svg", b"<svg/>".as_slice()),
            ("figures/גרף.png", b"\x89PNG\r\n\x1a\n".as_slice()),
            ("photo.jpeg", b"\xff\xd8\xff".as_slice()),
            ("animation.gif", b"GIF89a".as_slice()),
            ("photo.webp", b"RIFF0000WEBP".as_slice()),
        ] {
            fs::write(root.join(name), bytes).unwrap();
        }
        let refs = vec![
            "figures/plot space.svg",
            "figures/גרף.png",
            "photo.jpeg",
            "animation.gif",
            "photo.webp",
        ];
        let result = resolve(
            "image-test-formats",
            &path,
            refs.into_iter().map(String::from).collect(),
        )
        .unwrap();
        assert!(
            result.iter().all(|r| r.key.is_some()),
            "{:?}",
            result.iter().map(|r| &r.error).collect::<Vec<_>>()
        );
        let key = result[0].key.as_ref().unwrap();
        let response = respond(request(key));
        let etag = response.headers()["etag"].clone();
        let conditional = Request::builder()
            .uri(format!("http://litemd-image.localhost/{key}"))
            .header("if-none-match", etag)
            .body(Vec::new())
            .unwrap();
        assert_eq!(respond(conditional).status(), 304);
        release_document_images("image-test-formats");
    }
}
