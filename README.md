# LiteMD — Ultra-Lightweight Live-Preview Markdown & LaTeX Math Editor

**LiteMD** is a standalone, native desktop Markdown & LaTeX Math editor built with **Rust + Tauri v2**, **markdown-it**, and **offline-bundled KaTeX**. Its 1992 systems/demoscene design goals are fast startup, minimal memory use, and incremental work. It uses line-offset-invariant block caching, cached editor highlights and wrap measurements, and a single native executable including offline mathematical fonts. Startup time and memory use require measurements on the target machine.

---

## Key Features

### 1. Five-Stage Math-First Pre-Parser (`src/lib/mathNormalizer.ts` & `src/lib/renderer.ts`)
- **Stage 1 (Code Protection):** Fenced code blocks (` ``` ` / `~~~`, including 0-line and 1-line blocks) and inline code spans (`` `...` ``) are masked before math extraction while preserving exact line counts (`data-line`).
- **Stage 2 (Math Extraction & Delimiter Normalization):** Extracts display math (`$$...$$`, unescaped `\[...\]`, and standalone `\begin{equation|align|aligned|gather|gathered|bmatrix|pmatrix|vmatrix|cases|...}`) and inline math (unescaped `\(...\)` and `$...$`) into strictly alphanumeric tokens (`LITEMDMATHBLOCK{i}END` / `LITEMDMATHINLINE{i}END`) containing **zero underscores**—preventing Markdown emphasis parsers from mangling `x_1 + x_2`, `\\` matrix row breaks, or `|x|` inside GFM tables.
- **Stage 3 (Markdown AST, BiDi RTL Support & Scroll Sync):** Renders CommonMark + GFM tables, task lists, strikethrough, and footnotes with `data-line` / `data-source-line` attributes and automatic bidirectional (`dir="auto"`) layout for RTL languages (such as Hebrew) while keeping math and code strictly `dir="ltr"`.
- **Stage 4 (Offline KaTeX Rendering & Graceful Error Recovery):** Renders math via locally bundled KaTeX (`throwOnError: false, trust: false`). Unclosed or mid-typing equations display in a soft amber preview box (`.litemd-math-incomplete`) without breaking surrounding layout.
- **Stage 5 (Code Restoration & Token-Safe Syntax Highlighting):** Restores protected code spans with single-pass raw tokenization so HTML entities (`'` / `&#39;`), Rust lifetimes (`'a`), and `#` comments never collide.
- **Line-Offset-Invariant Dirty-Region Block Cache:** Uses FNV-1a block hashing (`fnv1aHash`) independent of line number (`startLine`) plus KaTeX memoization. Inserting or deleting lines above unchanged blocks reuses their parsed HTML and shifts `data-line` attributes without re-running `markdown-it` or KaTeX.

### 2. Dual-Engine UI, Multi-Tab Workspace & Crash-Safe Session Cache (`src/main.ts`)
- **Engine A — Split-Pane Live Preview (`Ctrl+\`):** Resizable split view with raw syntax-highlighted Markdown/LaTeX on the left and live-rendered output on the right, synchronized via `data-line` interpolation (`Editor-Only` via `Ctrl+Shift+E`, `Reader/Preview-Only` via `Ctrl+Shift+V`).
- **Engine B — Inline Live-Rendering Editor (`Ctrl+E`):** Unfocused blocks render in-place as formatted HTML/KaTeX; clicking any block reveals its raw Markdown/LaTeX source in place while preserving exact blank-line structure and undo history.
- **Multi-Tab Bar & Automatic Session Snapshot:** Work across multiple documents simultaneously (`Ctrl+N`, `Ctrl+W`, `Ctrl+Tab`). Unsaved buffers and open tabs are automatically snapshotted to disk and restored on launch, with window-close protection, atomic `.tmp`-then-rename saves, external modification conflict detection, and UTF-8 / UTF-16 / Windows-1255 (Hebrew) encoding support.

### 3. Hardened Security Model (`src-tauri/src/lib.rs` & `src-tauri/tauri.conf.json`)
- **Preview Security:** Arbitrary HTML passthrough is disabled. Optional presentation HTML is parsed inertly and rebuilt from explicit element, attribute, and CSS allowlists. Code fences remain escaped, KaTeX untrusted macros/links remain disabled (`trust: false`), unsafe URL schemes are blocked, and CSP remains enforced with `withGlobalTauri: false`.
- **Capability-Scoped File I/O:** The Rust backend only allows reading or writing paths explicitly authorized by the user via native OS file dialogs or CLI launch arguments, and blocks executable/script extensions and OS `Startup` folders.

### 4. Intelligent Visual Soft-Wrapping & Theme Studio (`src/lib/editorHelpers.ts` & `src/lib/themeStudio.ts`)
- Graphical width-threshold wrapping (`white-space: pre-wrap; overflow-wrap: break-word`) with per-line cached DOM height measurement and `↪` continuation markers in the line-number gutter—without mutating `\n` characters in the raw Markdown buffer.
- **Slide-Out Studio Drawer (`Ctrl+,`):** Live `:root` CSS Custom Property controls for fonts, sizes, line height, paragraph spacing, max line width, math scale (`--math-scale`), and 4 built-in presets (*LaTeX Academic Paper*, *Warm Sepia Textbook*, *Dark OLED Math*, *High-Contrast Blueprint*).

---

## Local images and presentation markup

Saved documents can load SVG, PNG, JPEG/JPG, GIF, and WebP images from their own folder or its subfolders, including filenames with spaces or Unicode:

~~~markdown
![Plot](./figures/plot with spaces.svg)

<figure>
  <img src="./plot.svg" alt="Mathematical plot">
  <figcaption><small>Figure 1. A quadratic correction.</small></figcaption>
</figure>
~~~

Unsaved documents show a placeholder until saved. Absolute paths, parent traversal (`..`), directory-junction escapes, non-image files, and unauthorized document paths are rejected. Only referenced image files receive revocable native image capabilities; the WebView never receives general folder access. Images use native decoding, without Base64 IPC or SVG DOM injection. HTTPS images continue to work. Limits are 32 MiB per local file, 512 distinct references per document, and 2,048 authorized images across open documents. Changed image files refresh on tab reactivation or reopening; there is no added background watcher.

Supported HTML includes `small`, `strong`, `em`, `span`, paragraphs, headings, `div`, `section`, figures, images, lists, blockquotes, and basic tables. Use Markdown for links and fenced code. Scripts, interactive forms, frames, inline SVG/MathML, event handlers, arbitrary attributes, and executable URLs are excluded.

Optional `<style>` blocks and `style` attributes support colors, font settings, spacing, borders, size constraints, alignment, and simple flex layouts. Stylesheet selectors support allowed tag/class names, descendants, child selectors, and comma groups. Rules are scoped to author-written HTML in the active document; they cannot target the toolbar, editor, dialogs, or KaTeX internals. CSS imports, resource URLs, variables, pseudo/attribute/id selectors, at-rules, animations, fixed positioning, and arbitrary browser CSS are intentionally unsupported. Use small presentation fragments, not complete web pages. HTML blocks are limited to 65,536 UTF-16 code units/512 nodes/32 levels; stylesheets to 32,768 code units/128 rules.

The normal Markdown path retains block caching. Native HTML/CSS parser objects and image maps are created only when needed, and caption edits reuse unchanged image nodes. See [the compatibility engineering report](COMPATIBILITY-REPORT.md) for measured results and verification details.

## Install and launch on Windows

Download the **x64 setup executable** from [GitHub Releases](https://github.com/CarlFriGauss/LiteMD/releases/latest), run it, and choose an installation folder. The installer adds LiteMD to the Start menu and offers a desktop shortcut and the **litemd** terminal command. No Rust, Node.js, npm, or source checkout is needed to use it. If the Windows WebView2 runtime is missing, setup downloads Microsoft's runtime once; Markdown, mathematics, and bundled fonts then work offline.

After installing, open **Start → LiteMD**, use the desktop shortcut, or open a **new terminal**:

~~~powershell
litemd
litemd "D:\Documents\notes.md"
~~~

The optional portable executable can be run directly, without installing. It uses the same rendering code but does not create shortcuts or add PATH.

Drafts, open tabs, and settings live separately from the installed executable, by default under **%LOCALAPPDATA%\com.litemd.editor**. Set the per-user environment variable **LITEMD_DATA_DIR** to choose another location, for example **D:\Apps\LiteMD-data**; restart LiteMD after changing it. Copy an existing data directory before switching locations. The original developer workspace data on D: remains supported for migration. Uninstalling preserves data by default; the installer's explicit “Delete app data” option removes the default data directory only. Custom data directories are kept.

To update, close LiteMD normally and run the newer installer. Keep your Markdown files and draft data outside the executable directory. Setup removes only its own PATH entry on uninstall and preserves pre-existing user entries. Silent setup supports /S, optional /NOPATH, and /D=... as the final argument.

Release files include SHA-256 checksums. Initial builds are unsigned, so Windows may display an unknown-publisher prompt.

## Build from source

For development, install the standard Tauri Windows prerequisites (Rust, Node.js, and Microsoft C++ build tools), clone this repository, then run **npm ci**. This host already has Rust; do not reinstall its toolchain. The environment script below uses existing local tooling and stores build caches in the project.

```powershell
# 1. Load portable project build & cache environment
. .\litemd-env.ps1

# 2. Run automated TypeScript & Rust test suites
npm test
npm run build # Rust's test harness embeds these frontend assets too
Push-Location src-tauri
cargo test --locked -j 1
Pop-Location

# 3. Launch in development mode
npx tauri dev

# 4. Build stripped production release binary
npm run build
Set-Location src-tauri
cargo build --release --locked -j 1
```

Run Cargo from `src-tauri` consistently: local Cargo configuration is resolved from the current directory, so switching directories can change compiler flags and force dependency rebuilds. The environment script defaults to one compiler job; this affects building only.

The CSP explicitly allows style attributes (`style-src-attr 'unsafe-inline'`) because KaTeX uses them for equation layout. Tauri adds a nonce to `style-src`, which otherwise blocks these attributes even when that directive includes `'unsafe-inline'`. Script restrictions, presentation allowlists, and untrusted KaTeX commands remain enforced. The main window also grants `core:window:allow-destroy`, which Tauri's unsaved-changes close handler needs to finish an approved close.

To package the executable with the installer, return to the repository root and run **npm run tauri -- bundle --bundles nsis --ci --no-binary-patching**. This packages the exact same executable offered as the portable download. NSIS tools are cached inside **target/.tauri**, not the user's system cache. The installer appears under **target/release/bundle/nsis**.

The official icon source is **src-tauri/icons/LiteMD-Icon1.png**, preserved with its original colors, proportions, and transparency. The Windows ICO and the three configured PNG sizes are generated with the existing **tauri icon** command. Regenerate into a temporary D: directory and copy those four outputs into **src-tauri/icons**; rebuild both the executable and NSIS installer after changing icons.

The Windows GitHub Actions workflow runs the frontend/native tests, builds an optimized executable and installer, and checks installation, Start menu/PATH registration, uninstallation, and draft-data preservation on a clean Windows runner. Every main-branch build uploads downloadable artifacts. A version tag matching the app version (for example **v0.1.0**) also creates a draft GitHub Release with the installer, portable executable, and checksums; publish it after final verification.

## License

Licensed under the [MIT License](LICENSE).
