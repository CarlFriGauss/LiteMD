# Project Specification: LiteMD — Ultra-Lightweight Live-Preview Markdown & Math Editor

## 1. Executive Summary & Core Philosophy
**LiteMD** is a standalone, native desktop text editor for Windows engineered in **Rust** for writing, editing, and reading Markdown (`.md`) documents with heavy mathematical and statistical notation.

### The Core Problem It Solves
1. **IDE Bloat Elimination:** Opening a heavy IDE like VS Code just to read or write a Markdown file introduces massive memory overhead, background indexing, 10–20 minute responsiveness delays, and intrusive code-autocomplete popups that disrupt mathematical and prose writing.
2. **Notepad Speed + Live Visual Verification:** Writing raw Markdown requires zero code-assistance bloat—a plain editor as fast as Windows Notepad is ideal for typing, yet complex mathematical equations and document layouts require **instantaneous live visual rendering** to verify accuracy while writing or reading.
3. **Eliminating Renderer Discrepancies (Pandoc vs. Browser Extensions):** Different Markdown/LaTeX engines frequently fail on valid files due to conflicting delimiter rules, whitespace sensitivity, or Markdown parsers corrupting math subscripts and matrix line breaks. LiteMD implements a **Unified Math-First Pre-Parser Pipeline** so that any valid Markdown and LaTeX syntax renders identically and flawlessly every time.

---

## 2. Architecture & Technology Stack
* **Native Backend & Application Shell:** **Rust + Tauri v2**
  * Compiles to a tiny, native Windows executable (`.exe`) using the operating system's native WebView2 runtime with near-zero cold-boot latency (under 150 ms).
  * Handles native file I/O, file-system watching (auto-reloading if edited externally), and command-line argument parsing directly in Rust.
* **Frontend UI Layer:** **Vanilla TypeScript / Svelte 5 (Minimal Footprint)**
  * Explicitly **forbids** heavy IDE editor cores like Monaco (the engine inside VS Code) to guarantee instantaneous startup.
  * Uses a lightweight, zero-lag text editing surface with all code-completion/IntelliSense popups permanently disabled.
* **Markdown & Mathematical Rendering Pipeline:**
  * **Pre-Processor:** Custom Rust/TypeScript **Math-Masking & Delimiter Normalizer** (protects math tokens before Markdown parsing).
  * **Markdown Parser:** `markdown-it` or `pulldown-cmark` configured with GitHub Flavored Markdown (GFM), tables, footnotes, task lists, and strikethrough.
  * **Math Engine:** **KaTeX** (bundled locally for 100% offline, sub-millisecond rendering) configured with `throwOnError: false`, `trust: true`, and standard AMS math environments.

---

## 3. Dual-Engine Editing & Preview Architecture

LiteMD incorporates **both** live-rendering paradigms in a single lightweight application, switchable at any time via keyboard shortcuts:

### Engine A: Split-Pane Simultaneous Live Preview (Default Mode)
* **Left Pane (Raw Editor):** A clean, distraction-free plain-text Markdown editor with fast text entry, line numbers (toggleable), word wrap, and zero autocomplete interference.
* **Right Pane (Live Rendered Document):** A publication-grade rendered view that updates instantaneously on every keystroke with zero flicker or compilation lag.
* **Synchronized Scrolling:** Scrolling in the raw editor proportionally scrolls the rendered preview pane (and vice versa), anchored by source-line mapping (`data-source-line` attributes).
* **Layout Toggles:**
  * **Split View (`Ctrl+\`):** 50/50 resizable side-by-side editor and live preview.
  * **Reading / Preview-Only Mode (`Ctrl+Shift+V`):** Collapses the raw editor into a full-window rendered reader for studying existing `.md` notes immediately upon opening.
  * **Raw Editor-Only Mode (`Ctrl+Shift+E`):** Pure Notepad-style distraction-free writing.

### Engine B: Inline Live-Rendering Editor Mode (Block/Line WYSIWYG)
* **Toggled via `Ctrl+E`:** Replaces the split screen with a single unified editor canvas (modeled after Lexical / CodeMirror 6 state-field live preview).
* **How It Works:**
  * The line or block where your cursor is currently active displays raw Markdown/LaTeX tokens (`#`, `**`, `$ ... $`, `$$ ... $$`) so you can edit the exact syntax with precision.
  * The moment your cursor leaves that line or block, the raw syntax collapses and renders **inline in place**—displaying formatted headings, bold/italic text, tables, and fully typeset KaTeX equations directly inside the editor flow.
  * Clicking on any rendered equation or block immediately reveals its underlying raw Markdown/LaTeX source for editing.
  * Supports quick slash commands (`/math`, `/matrix`, `/align`, `/table`, `/code`) that insert clean Markdown/LaTeX boilerplate blocks without intrusive word-completion popups.

---

## 4. Universal Markdown & Mathematical Syntax Robustness

To ensure that any valid Markdown file renders accurately regardless of whether it was authored for Pandoc, Obsidian, GitHub, LaTeX, or Chrome Markdown Preview extensions, the rendering pipeline **must** enforce the following 5-stage normalization rules before rendering:

### Rule 1: Pre-Markdown Math Extraction (Token Masking)
Standard Markdown parsers often corrupt LaTeX math before the math renderer ever sees it because Markdown interprets `_` (subscripts like $x_1$ and $x_2$) as *italics*, `*` (conjugate transpose $A^*$ or multiplication) as *emphasis*, and `\\` (newlines in matrices and aligned equations) as escaped backslashes.
* **Requirement:** Before passing text to the Markdown parser, the engine **must** extract all inline and display math blocks, replace them with safe unique placeholders (`@@MATH_BLOCK_0@@`, `@@MATH_INLINE_1@@`), parse the standard Markdown, and then restore and render the math blocks via KaTeX.

### Rule 2: Universal Math Delimiter Support
The math extractor must natively recognize and normalize **all** of the following delimiter conventions without requiring user configuration:
1. **Inline Math:**
   * Single-dollar syntax: `$ ... $`
   * LaTeX round-bracket syntax: `\( ... \)`
2. **Display / Block Math:**
   * Double-dollar syntax (both single-line and multi-line): `$$ ... $$`
   * LaTeX square-bracket syntax (both single-line and multi-line): `\[ ... \]`
   * Standalone LaTeX environments even when *not* wrapped in `$$` or `\[...\]`:
     * `\begin{equation} ... \end{equation}` (and `equation*`)
     * `\begin{align} ... \end{align}` (and `align*`, `aligned`)
     * `\begin{gather} ... \end{gather}` (and `gather*`, `gathered`)
     * `\begin{bmatrix} ... \end{bmatrix}`, `\begin{pmatrix} ... \end{pmatrix}`, `\begin{cases} ... \end{cases}`

### Rule 3: Forgiving Whitespace & Newline Handling inside Math
* **Pandoc vs. Browser Whitespace Fix:** Pandoc fails when there is a space after the opening `$` or before the closing `$` (e.g., `$ x + y $`), whereas other parsers fail when `$` touches punctuation. LiteMD's inline `$ ... $` parser must accept formulas regardless of inner padding spaces (while avoiding false positives on currency like `$50 and $100` by checking that the block contains valid math characters or closes on the same paragraph).
* **Blank Lines Inside Display Math:** Many authors leave blank lines inside `$$ ... $$` or `\[ ... \]` blocks for readability, which breaks standard CommonMark parsers. LiteMD must permit arbitrary blank lines inside display math blocks without breaking the block.

### Rule 4: Complete Standard Markdown & GFM Support
* Standard ATX headers (`# H1` through `###### H6`) and Setext headers.
* Bold (`**bold**` and `__bold__`), Italic (`*italic*` and `_italic_`), Bold+Italic (`***text***`), and Strikethrough (`~~text~~`).
* Ordered lists (`1.`), unordered lists (`-`, `*`, `+`), nested lists, and interactive task lists (`- [ ]`, `- [x]`).
* Fenced code blocks with syntax highlighting, inline code spans, blockquotes (`>`), horizontal rules (`---`), footnotes (`[^1]`), and GFM pipe tables (allowing inline math `$ ... $` inside table cells, including escaped or unescaped vertical bars `\vert` / `|` inside absolute values $|x|$).

### Rule 5: Fault-Tolerant Error Recovery
* If a user is mid-way through typing an incomplete equation (e.g., an unclosed `\frac{a}` or missing closing brace), the renderer must **never** crash or blank out the preview. Only the incomplete expression should highlight softly in amber while the rest of the document and equations remain fully rendered.

---

## 5. Native OS Integration, UI & Keyboard Shortcuts

* **Command-Line & File Explorer Launch:**
  * Running `litemd notes.md` from PowerShell/Terminal or double-clicking any `.md` file in Windows Explorer must open the file directly in under 150 ms.
* **Scrollbars & Theme:**
  * Permanent, classic, high-visibility vertical scrollbars on both panes.
  * Instant toggle between Clean Light Mode (paper-white academic styling) and Dark Mode (`Ctrl+Shift+T`).
* **Essential Keyboard Shortcuts:**
  * `Ctrl+N`: New file
  * `Ctrl+O`: Open `.md` file
  * `Ctrl+S` / `Ctrl+Shift+S`: Save / Save As
  * `Ctrl+Shift+V`: Toggle Preview-Only Reading Mode vs. Split View
  * `Ctrl+\`: Toggle Split-Pane Simultaneous Preview On/Off
  * `Ctrl+E`: Toggle Engine B (Inline Live-Rendering Mode) vs. Engine A (Split-Pane Mode)
  * `Ctrl+P`: Export / Print rendered document to clean PDF
  * `Ctrl++` / `Ctrl+-` / `Ctrl+0`: Zoom font size in editor and preview
  
 
 
---

## 6. Intelligent Visual Soft-Wrapping (Zero Raw File Mutation)

* **Automatic Viewport & Width-Threshold Wrapping:** When typing a continuous paragraph without pressing `Enter`, lines in the editor must never stretch horizontally off-screen into an unreadable single line. Once a line crosses the editor pane's width threshold (or a user-adjustable comfortable reading column width, e.g., `65ch` to `100ch` or `100%` pane width), the editor must automatically wrap the text visually onto the next display line at word boundaries.
* **Strict Separation of Presentation vs. Raw Buffer:** This line wrapping is **100% graphical/visual** (`white-space: pre-wrap; overflow-wrap: break-word`). It must **never** insert actual newline characters (`\n` or `\r\n`) into the underlying raw Markdown string buffer or the saved `.md` file on disk. A paragraph remains a single logical line in raw Markdown until the user explicitly presses `Enter`.
* **Visual Continuation Cue:** Provide a subtle, zero-cost visual indicator in the gutter (or clean hanging indentation) so the user can effortlessly tell the difference between a soft-wrapped continuation line and a hard line break (`Enter`).

---

## 7. Out-of-the-Box Theme, Typography & Layout Studio

The application must give the user effortless, granular visual control over every aesthetic aspect of both the **Raw Editor** and especially the **Rendered Preview Page**, powered by zero-lag CSS Custom Properties (`--var`) that update at 60fps without re-parsing the document:

### A. Rendered Preview Page Customization
* **Typography:** Independent font-family selectors for **Body Text** (serif/sans-serif), **Headings**, **Code Blocks** (monospace), and **Math**; live scrubbable sliders for base font size, line height, letter spacing, and paragraph spacing.
* **Page Geometry & Margins:** Live sliders for top/bottom and left/right page margins, maximum readable column width (e.g., narrow book page vs. wide academic layout), and section spacing.
* **Granular Color Palette:** Independent color pickers (with hex/RGB input and eye-dropper support) for:
  * Page Canvas Background & Outer Workspace Background
  * Primary Body Font Color & Muted/Secondary Text Color
  * **Header Colors:** Ability to set a unified heading color OR customize `H1`, `H2`, `H3`, and `H4–H6` colors and bottom-border accents individually
  * **Math & LaTeX Blocks:** Custom text color and optional subtle background tint/border for display math (`$$...$$` / `\[...\]`) so complex equations stand out cleanly
  * Blockquote accent bars, inline code pills, links, and table borders/striping

### B. Raw Editor Customization (Optimized for Writing Markdown)
* Independent editor font family, font size, line height, and **Soft-Wrap Column Width** slider.
* Subtle syntax-highlighting token colors specifically tuned to make raw Markdown effortless to scan while writing (distinct, non-distracting colors for `#` heading markers, `**bold**` / `*italic*` markers, and especially `$ ... $` / `\[ ... \]` math regions so the writer can immediately see where a math block opens and closes).

### C. Creative, Zero-Friction UI Controls (Think Outside the Box)
* **Direct "Click-to-Style" Preview Inspector Mode:** Include a toggleable *"Inspect / Style Element"* brush icon in the toolbar. When toggled on, clicking directly on any rendered element in the Preview pane (e.g., clicking an `H1` header, a paragraph, a `\[...\]` equation block, or the page margin) pops up a tiny, context-aware floating mini-palette right next to that element to adjust its exact color, font, size, or spacing on the spot.
* **Slide-Out Studio Drawer (`Ctrl+,`):** A sleek, collapsible side drawer with live scrubbers, linked/unlinked color controls, and one-click **Theme Presets** (e.g., *LaTeX Academic Paper*, *Warm Sepia Textbook*, *Dark OLED Math*, *High-Contrast Blueprint*) plus the ability to save/export custom user themes as lightweight JSON files on the `D:\` drive.