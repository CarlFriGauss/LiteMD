# LiteMD — Ultra-Lightweight Live-Preview Markdown & LaTeX Math Editor

**LiteMD** is a standalone, native Windows desktop Markdown & LaTeX Math editor built with **Rust + Tauri v2**, **markdown-it**, and **offline-bundled KaTeX**. Engineered with a 1992 systems/demoscene philosophy: sub-30ms cold boot, dirty-region block caching, zero unnecessary allocations, and a ~4 MB stripped native executable.

---

## Key Features

### 1. Bulletproof 5-Stage Math-First Pre-Parser (`src/lib/mathNormalizer.ts` & `src/lib/renderer.ts`)
- **Stage 1 (Code Protection):** Fenced code blocks (` ``` ` / `~~~`) and inline code spans (`` `...` ``) are masked before math extraction while preserving exact line counts (`data-line`).
- **Stage 2 (Math Extraction & Delimiter Normalization):** Extracts display math (`$$...$$`, `\[...\]`, and standalone `\begin{equation|align|aligned|gather|gathered|bmatrix|pmatrix|vmatrix|cases|...}`) and inline math (`\(...\)` and `$...$`) into strictly alphanumeric tokens (`LITEMDMATHBLOCK{i}END` / `LITEMDMATHINLINE{i}END`) containing **zero underscores**—preventing Markdown emphasis parsers from mangling `x_1 + x_2`, `\\` matrix row breaks, or `|x|` inside GFM tables.
- **Stage 3 (Markdown AST & Scroll Sync):** Renders CommonMark + GFM tables, task lists, strikethrough, and footnotes with `data-line` / `data-source-line` attributes on every top-level block.
- **Stage 4 (Offline KaTeX Rendering & Graceful Error Recovery):** Renders math via locally bundled KaTeX (`throwOnError: false, trust: true`). Unclosed or mid-typing equations display in a soft amber preview box (`.litemd-math-incomplete`) without breaking surrounding layout.
- **Stage 5 (Code Restoration & Syntax Highlighting):** Restores protected code spans with lightweight syntax highlighting.
- **Dirty-Region Block Cache:** Uses FNV-1a block hashing (`fnv1aHash`) and KaTeX memoization so unchanged paragraphs and equations are never re-parsed during typing.

### 2. Dual-Engine UI (`src/main.ts`)
- **Engine A — Split-Pane Live Preview (`Ctrl+\`):** Resizable split view with raw syntax-highlighted Markdown/LaTeX on the left and live-rendered output on the right, synchronized via `data-line` interpolation (`Editor-Only` via `Ctrl+Shift+E`, `Reader/Preview-Only` via `Ctrl+Shift+V`).
- **Engine B — Inline Live-Rendering Editor (`Ctrl+E`):** Unfocused blocks render in-place as formatted HTML/KaTeX; clicking any block reveals its raw Markdown/LaTeX source with live equation preview and slash commands (`/math`, `/matrix`, `/align`, `/table`, `/code`).

### 3. Intelligent Visual Soft-Wrapping (`src/lib/editorHelpers.ts`)
- Graphical width-threshold wrapping (`white-space: pre-wrap; overflow-wrap: break-word`) with visual `↪` continuation markers in the line-number gutter.
- **Zero raw buffer mutation:** Visual soft-wrapping never inserts `\n` characters into the underlying Markdown string buffer.

### 4. Theme, Typography & Layout Studio (`src/lib/themeStudio.ts`)
- **Slide-Out Studio Drawer (`Ctrl+,`):** Real-time 60fps `:root` CSS Custom Property controls for fonts, sizes, line height, paragraph spacing, max line width, math scale (`--math-scale`), and colors.
- **4 Built-In Presets:** *LaTeX Academic Paper*, *Warm Sepia Textbook*, *Dark OLED Math*, and *High-Contrast Blueprint*, plus custom JSON theme persistence.
- **Direct "Click-to-Style" Preview Inspector:** Toggle the toolbar brush icon and click any rendered heading, paragraph, equation, or code block to style its category directly via a floating mini-palette.

---

## Quick Start

```powershell
# 1. Load D:\ drive build & cache environment
. .\litemd-env.ps1

# 2. Run automated math edge-case tests
npm test

# 3. Launch in development mode
npx tauri dev

# 4. Build stripped production release binary
npm run build
Set-Location src-tauri
cargo build --release
```
