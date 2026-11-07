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
- **Preview Security:** Raw HTML passthrough is disabled (`html: false`), code fences are escaped, KaTeX untrusted macros/links are disabled (`trust: false`), `javascript:` / `vbscript:` / `data:` URLs are blocked, and a Content Security Policy (CSP) is enforced with `withGlobalTauri: false`.
- **Capability-Scoped File I/O:** The Rust backend only allows reading or writing paths explicitly authorized by the user via native OS file dialogs or CLI launch arguments, and blocks executable/script extensions and OS `Startup` folders.

### 4. Intelligent Visual Soft-Wrapping & Theme Studio (`src/lib/editorHelpers.ts` & `src/lib/themeStudio.ts`)
- Graphical width-threshold wrapping (`white-space: pre-wrap; overflow-wrap: break-word`) with per-line cached DOM height measurement and `↪` continuation markers in the line-number gutter—without mutating `\n` characters in the raw Markdown buffer.
- **Slide-Out Studio Drawer (`Ctrl+,`):** Live `:root` CSS Custom Property controls for fonts, sizes, line height, paragraph spacing, max line width, math scale (`--math-scale`), and 4 built-in presets (*LaTeX Academic Paper*, *Warm Sepia Textbook*, *Dark OLED Math*, *High-Contrast Blueprint*).

---

## Quick Start

```powershell
# 1. Load portable project build & cache environment
. .\litemd-env.ps1

# 2. Run automated TypeScript & Rust test suites
npm test
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

The CSP explicitly allows style attributes (`style-src-attr 'unsafe-inline'`) because KaTeX uses them for equation layout. Tauri adds a nonce to `style-src`, which otherwise blocks these attributes even when that directive includes `'unsafe-inline'`. Script restrictions, raw HTML escaping, and untrusted KaTeX commands remain enforced. The main window also grants `core:window:allow-destroy`, which Tauri's unsaved-changes close handler needs to finish an approved close.

## License

Licensed under the [MIT License](LICENSE).
