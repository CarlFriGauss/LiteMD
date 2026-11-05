/**
 * LiteMD — Main Application Entry & Dual-Engine UI Controller
 *
 * Implements:
 * - Engine A: Split-Pane Simultaneous Live Preview with `data-source-line` bidirectional scroll sync
 * - Engine B: Inline Live-Rendering Editor Mode (`Ctrl+E`) with slash-command expansion
 * - Intelligent Visual Soft-Wrapping (Section 6) with `↪` gutter continuation cues & zero raw buffer mutation
 * - Out-of-the-Box Theme, Typography & Layout Studio (`Ctrl+,`) & Direct "Click-to-Style" Preview Inspector
 */

import 'katex/dist/katex.min.css';
import './styles/app.css';

import { DEFAULT_DOCUMENT } from './lib/defaultDocument';
import {
  renderIncrementalPreview,
  renderMarkdown,
  splitIntoLogicalBlocks,
  LogicalBlock,
} from './lib/renderer';
import {
  highlightRawMarkdownForBackdrop,
  buildLineMeasurerHtml,
  buildSoftWrapGutterHtml,
  tryExpandSlashCommand,
} from './lib/editorHelpers';
import {
  LiteMDThemeConfig,
  THEME_PRESETS,
  FONT_OPTIONS,
  applyThemeToDOM,
  cloneTheme,
} from './lib/themeStudio';
import {
  readMarkdownFile,
  saveMarkdownFile,
  getCliFileArg,
  getFileMtime,
  pickOpenMarkdownFile,
  pickSaveMarkdownFile,
  saveCustomThemeOnD,
  listCustomThemesOnD,
  updateNativeWindowTitle,
} from './lib/tauriBridge';

type EngineMode = 'engine-a' | 'engine-b';
type SplitLayoutMode = 'split' | 'preview-only' | 'editor-only';

interface AppState {
  markdown: string;
  filePath: string | null;
  lastSavedMtime: number;
  isDirty: boolean;
  engineMode: EngineMode;
  splitLayout: SplitLayoutMode;
  showLineNumbers: boolean;
  inspectorActive: boolean;
  studioOpen: boolean;
  activeInlineBlockIdx: number | null;
  theme: LiteMDThemeConfig;
  customThemes: Record<string, LiteMDThemeConfig>;
  renderedBlocks: LogicalBlock[];
}

const state: AppState = {
  markdown: DEFAULT_DOCUMENT,
  filePath: null,
  lastSavedMtime: 0,
  isDirty: false,
  engineMode: 'engine-a',
  splitLayout: 'split',
  showLineNumbers: true,
  inspectorActive: false,
  studioOpen: false,
  activeInlineBlockIdx: null,
  theme: cloneTheme(THEME_PRESETS['latex-academic']),
  customThemes: {},
  renderedBlocks: [],
};

// Apply initial theme to `:root` before building DOM
applyThemeToDOM(state.theme);

const appRoot = document.getElementById('app')!;

appRoot.innerHTML = `
  <!-- Top Command & Mode Bar -->
  <header class="litemd-toolbar">
    <div class="litemd-toolbar-group">
      <div class="litemd-brand" title="LiteMD — Ultra-Lightweight Rust + Tauri v2 Markdown & Math Editor">
        <span>∑ LiteMD</span>
      </div>
      <button class="litemd-btn" id="btn-new" title="New Document (Ctrl+N)">New</button>
      <button class="litemd-btn" id="btn-open" title="Open Markdown File (Ctrl+O)">Open…</button>
      <button class="litemd-btn" id="btn-save" title="Save File (Ctrl+S)">Save</button>
      <button class="litemd-btn" id="btn-save-as" title="Save As… (Ctrl+Shift+S)">Save As</button>
      <button class="litemd-btn" id="btn-print" title="Export / Print Clean PDF (Ctrl+P)">PDF</button>
      <div class="litemd-file-pill" id="file-pill" title="Current File Path">
        <span class="litemd-dirty-dot" id="dirty-dot"></span>
        <span id="file-label">Untitled.md</span>
      </div>
    </div>

    <div class="litemd-toolbar-group">
      <button class="litemd-btn is-active" id="btn-mode-split" title="Split-Pane Simultaneous View (Ctrl+\\)">
        Split <span class="litemd-kbd">Ctrl+\\</span>
      </button>
      <button class="litemd-btn" id="btn-mode-reader" title="Reading / Preview-Only Mode (Ctrl+Shift+V)">
        Reader <span class="litemd-kbd">Ctrl+⇧+V</span>
      </button>
      <button class="litemd-btn" id="btn-mode-editor" title="Raw Editor-Only Mode (Ctrl+Shift+E)">
        Raw <span class="litemd-kbd">Ctrl+⇧+E</span>
      </button>
      <button class="litemd-btn" id="btn-engine-b" title="Toggle Engine B: Inline Live-Rendering Editor Mode (Ctrl+E)">
        Inline WYSIWYG <span class="litemd-kbd">Ctrl+E</span>
      </button>
    </div>

    <div class="litemd-toolbar-group">
      <button class="litemd-btn" id="btn-soft-wrap" title="Toggle Intelligent Visual Soft-Wrapping (Zero Raw File Mutation)">
        Wrap: ON
      </button>
      <button class="litemd-btn" id="btn-line-nums" title="Toggle Line Numbers & Soft-Wrap Gutter">
        Lines
      </button>
      <button class="litemd-btn litemd-btn-inspector" id="btn-inspector" title="Direct 'Click-to-Style' Preview Inspector Mode">
        🖌️ Inspect & Style
      </button>
      <button class="litemd-btn" id="btn-theme-toggle" title="Instant Light / Dark Mode Toggle (Ctrl+Shift+T)">
        ☀️ / 🌙
      </button>
      <button class="litemd-btn" id="btn-studio" title="Theme, Typography & Layout Studio Drawer (Ctrl+,)">
        🎨 Studio <span class="litemd-kbd">Ctrl+,</span>
      </button>
    </div>
  </header>

  <!-- Main Dual-Engine Workspace -->
  <main class="litemd-workspace">
    <!-- ENGINE A: Split-Pane Simultaneous Live Preview -->
    <section class="litemd-engine-a" id="engine-a" data-layout="split">
      <!-- Left Pane: Raw Editor with Soft-Wrap Gutter & Syntax Mirror -->
      <div class="litemd-pane-editor" id="pane-editor" style="width: 50%;">
        <div class="litemd-editor-scroll-viewport litemd-classic-scroll" id="editor-scroller">
          <div class="litemd-gutter" id="editor-gutter" aria-hidden="true"></div>
          <div class="litemd-editor-stage" id="editor-stage" data-soft-wrap="true">
            <div class="litemd-editor-measurer" id="editor-measurer" aria-hidden="true"></div>
            <pre class="litemd-editor-backdrop" id="editor-backdrop" aria-hidden="true"></pre>
            <textarea
              class="litemd-editor-textarea"
              id="editor-textarea"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              wrap="soft"
              aria-label="Raw Markdown Editor"
            ></textarea>
          </div>
        </div>
      </div>

      <!-- Draggable Split Divider -->
      <div class="litemd-divider" id="split-divider" title="Drag to resize split panes (Double-click to reset 50/50)"></div>

      <!-- Right Pane: Live Rendered Document -->
      <div class="litemd-pane-preview litemd-classic-scroll" id="preview-scroller">
        <article class="litemd-preview-sheet" id="preview-sheet"></article>
      </div>
    </section>

    <!-- ENGINE B: Inline Live-Rendering Editor Mode (Block/Line WYSIWYG) -->
    <section class="litemd-engine-b litemd-classic-scroll" id="engine-b">
      <div class="litemd-inline-canvas litemd-preview-sheet" id="inline-canvas"></div>
    </section>

    <!-- Direct "Click-to-Style" Preview Inspector Mini-Palette -->
    <div class="litemd-inspector-popover" id="inspector-popover">
      <div class="litemd-inspector-header">
        <span id="inspector-target-title">Style Element</span>
        <button class="litemd-btn" id="inspector-close" style="height:20px;padding:0 6px;">✕</button>
      </div>
      <div id="inspector-controls"></div>
    </div>

    <!-- Slide-Out Theme, Typography & Layout Studio Drawer (Ctrl+,) -->
    <aside class="litemd-studio-drawer" id="studio-drawer">
      <div class="litemd-studio-header">
        <span>🎨 Theme, Typography & Layout Studio</span>
        <button class="litemd-btn" id="studio-close">Close</button>
      </div>
      <div class="litemd-studio-body litemd-classic-scroll" id="studio-body"></div>
    </aside>
  </main>

  <!-- Status Bar -->
  <footer class="litemd-statusbar">
    <div class="litemd-status-group">
      <span id="status-engine">Engine A: Split Live Preview</span>
      <span id="status-cursor">Ln 1, Col 1</span>
      <span id="status-wrap-info">Soft-Wrap: 86ch (0 wrapped rows)</span>
    </div>
    <div class="litemd-status-group">
      <span id="status-stats">0 lines · 0 words · 0 chars</span>
      <span id="status-perf">Render: 0.2ms (Dirty-Block Cache)</span>
    </div>
  </footer>
`;

// Cache DOM references once (Law #2: zero repeated querySelector allocations in hot loops)
const elEngineA = document.getElementById('engine-a')!;
const elEngineB = document.getElementById('engine-b')!;
const elPaneEditor = document.getElementById('pane-editor')!;
const elSplitDivider = document.getElementById('split-divider')!;
const elEditorScroller = document.getElementById('editor-scroller')!;
const elEditorGutter = document.getElementById('editor-gutter')!;
const elEditorStage = document.getElementById('editor-stage')!;
const elEditorMeasurer = document.getElementById('editor-measurer')!;
const elEditorBackdrop = document.getElementById('editor-backdrop')!;
const elTextarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
const elPreviewScroller = document.getElementById('preview-scroller')!;
const elPreviewSheet = document.getElementById('preview-sheet')!;
const elInlineCanvas = document.getElementById('inline-canvas')!;

const elFileLabel = document.getElementById('file-label')!;
const elDirtyDot = document.getElementById('dirty-dot')!;
const elStatusEngine = document.getElementById('status-engine')!;
const elStatusCursor = document.getElementById('status-cursor')!;
const elStatusWrapInfo = document.getElementById('status-wrap-info')!;
const elStatusStats = document.getElementById('status-stats')!;
const elStatusPerf = document.getElementById('status-perf')!;

const elBtnSplit = document.getElementById('btn-mode-split')!;
const elBtnReader = document.getElementById('btn-mode-reader')!;
const elBtnEditor = document.getElementById('btn-mode-editor')!;
const elBtnEngineB = document.getElementById('btn-engine-b')!;
const elBtnSoftWrap = document.getElementById('btn-soft-wrap')!;
const elBtnLineNums = document.getElementById('btn-line-nums')!;
const elBtnInspector = document.getElementById('btn-inspector')!;
const elBtnStudio = document.getElementById('btn-studio')!;

const elStudioDrawer = document.getElementById('studio-drawer')!;
const elStudioBody = document.getElementById('studio-body')!;
const elInspectorPopover = document.getElementById('inspector-popover')!;
const elInspectorTitle = document.getElementById('inspector-target-title')!;
const elInspectorControls = document.getElementById('inspector-controls')!;

/**
 * Syncs the `<textarea>` height and backdrop/gutter so the outer `#editor-scroller`
 * handles all scrolling with a single classic scrollbar, and measures exact per-line
 * wrapped row heights from `#editor-measurer` so gutter line numbers never drift.
 */
function syncEditorBackdropAndGutter(): void {
  const raw = state.markdown;
  elEditorBackdrop.innerHTML = highlightRawMarkdownForBackdrop(raw);

  const wrapCh = state.theme.editorWrapColumnCh > 0 ? state.theme.editorWrapColumnCh : 92;
  let measuredRowsPerLine: number[] | undefined;

  if (state.theme.editorSoftWrapEnabled) {
    elEditorMeasurer.innerHTML = buildLineMeasurerHtml(raw);
    const singleRowPx = state.theme.editorFontSizePx * state.theme.editorLineHeight;
    const children = elEditorMeasurer.children;
    if (singleRowPx > 0 && children.length > 0) {
      const firstH = (children[0] as HTMLElement).offsetHeight;
      if (firstH > 0) {
        measuredRowsPerLine = new Array<number>(children.length);
        for (let i = 0; i < children.length; i++) {
          const h = (children[i] as HTMLElement).offsetHeight;
          measuredRowsPerLine[i] = Math.max(1, Math.round(h / singleRowPx));
        }
      }
    }
  }

  const { html: gutterHtml, logicalLines, visualWrappedExtraRows } =
    buildSoftWrapGutterHtml(
      raw,
      state.theme.editorSoftWrapEnabled,
      wrapCh,
      measuredRowsPerLine
    );

  if (state.showLineNumbers) {
    elEditorGutter.innerHTML = gutterHtml;
  }

  // Auto-size textarea to match its scrollHeight so #editor-scroller scrolls smoothly
  elTextarea.style.height = 'auto';
  const targetHeight = Math.max(
    elEditorScroller.clientHeight,
    elTextarea.scrollHeight,
    elEditorBackdrop.scrollHeight
  );
  elTextarea.style.height = `${targetHeight}px`;

  // Update status bar metrics
  const words = raw.trim().length === 0 ? 0 : raw.trim().split(/\s+/).length;
  elStatusStats.textContent = `${logicalLines} lines · ${words} words · ${raw.length} chars`;
  elStatusWrapInfo.textContent = state.theme.editorSoftWrapEnabled
    ? `Soft-Wrap: ${wrapCh}ch (+${visualWrappedExtraRows} visual rows, 0 raw \\n added)`
    : 'Soft-Wrap: OFF';
}

/**
 * Updates the live preview using our Dirty-Region Block Reconciler.
 */
function updateLivePreview(): void {
  const t0 = performance.now();
  if (state.engineMode === 'engine-a') {
    state.renderedBlocks = renderIncrementalPreview(elPreviewSheet, state.markdown);
  } else {
    renderEngineBInlineCanvas();
  }
  const elapsed = (performance.now() - t0).toFixed(2);
  elStatusPerf.textContent = `Render: ${elapsed}ms (Dirty-Block Cache)`;
}

/**
 * Updates cursor line & column indicator in status bar.
 */
function updateCursorStatus(): void {
  const pos = elTextarea.selectionStart || 0;
  const before = state.markdown.slice(0, pos);
  const lastNl = before.lastIndexOf('\n');
  let line = 1;
  for (let i = 0; i < pos; i++) {
    if (state.markdown.charCodeAt(i) === 10) line++;
  }
  const col = pos - lastNl;
  elStatusCursor.textContent = `Ln ${line}, Col ${col}`;
}

/**
 * Updates toolbar buttons & window title to reflect current state.
 */
function syncToolbarAndTitle(): void {
  const filename = state.filePath
    ? state.filePath.split(/[\\/]/).pop() || state.filePath
    : 'Untitled.md';
  elFileLabel.textContent = filename;
  elFileLabel.title = state.filePath || 'Unsaved buffer';
  elDirtyDot.classList.toggle('is-dirty', state.isDirty);
  void updateNativeWindowTitle(state.filePath, state.isDirty);

  const isEngineA = state.engineMode === 'engine-a';
  elEngineA.style.display = isEngineA ? 'flex' : 'none';
  elEngineB.classList.toggle('is-active', !isEngineA);

  elEngineA.setAttribute('data-layout', state.splitLayout);
  elBtnSplit.classList.toggle('is-active', isEngineA && state.splitLayout === 'split');
  elBtnReader.classList.toggle('is-active', isEngineA && state.splitLayout === 'preview-only');
  elBtnEditor.classList.toggle('is-active', isEngineA && state.splitLayout === 'editor-only');
  elBtnEngineB.classList.toggle('is-active', !isEngineA);

  elEditorStage.setAttribute(
    'data-soft-wrap',
    state.theme.editorSoftWrapEnabled ? 'true' : 'false'
  );
  elBtnSoftWrap.textContent = state.theme.editorSoftWrapEnabled ? 'Wrap: ON' : 'Wrap: OFF';
  elBtnSoftWrap.classList.toggle('is-active', state.theme.editorSoftWrapEnabled);

  elEditorGutter.classList.toggle('is-hidden', !state.showLineNumbers);
  elBtnLineNums.classList.toggle('is-active', state.showLineNumbers);

  elBtnInspector.classList.toggle('is-active', state.inspectorActive);
  elPreviewSheet.classList.toggle('inspector-mode', state.inspectorActive);

  elStudioDrawer.classList.toggle('is-open', state.studioOpen);
  elBtnStudio.classList.toggle('is-active', state.studioOpen);

  if (!isEngineA) {
    elStatusEngine.textContent = 'Engine B: Inline Live-Rendering (Click block to edit)';
  } else if (state.splitLayout === 'split') {
    elStatusEngine.textContent = 'Engine A: Split Live Preview';
  } else if (state.splitLayout === 'preview-only') {
    elStatusEngine.textContent = 'Engine A: Reader Mode (Preview Only)';
  } else {
    elStatusEngine.textContent = 'Engine A: Raw Editor Only';
  }
}

/* ============================================================================
 * Bidirectional Scroll Synchronization (`data-source-line` anchored)
 * ============================================================================ */
let scrollLockSource: 'editor' | 'preview' | null = null;
let scrollLockTimer = 0;

function lockScroll(source: 'editor' | 'preview'): void {
  scrollLockSource = source;
  window.clearTimeout(scrollLockTimer);
  scrollLockTimer = window.setTimeout(() => {
    scrollLockSource = null;
  }, 90);
}

elEditorScroller.addEventListener(
  'scroll',
  () => {
    if (scrollLockSource === 'preview' || state.splitLayout !== 'split') return;
    lockScroll('editor');

    const maxEditorScroll =
      elEditorScroller.scrollHeight - elEditorScroller.clientHeight;
    const maxPreviewScroll =
      elPreviewScroller.scrollHeight - elPreviewScroller.clientHeight;
    if (maxEditorScroll <= 0 || maxPreviewScroll <= 0) return;

    const ratio = elEditorScroller.scrollTop / maxEditorScroll;
    if (ratio <= 0.01) {
      elPreviewScroller.scrollTop = 0;
      return;
    }
    if (ratio >= 0.99) {
      elPreviewScroller.scrollTop = maxPreviewScroll;
      return;
    }

    // Compute approximate logical line at top of editor viewport
    const totalLines = Math.max(1, state.markdown.split('\n').length);
    const targetLine = ratio * totalLines;

    // Locate surrounding `[data-source-line]` blocks in preview sheet
    const blocks = elPreviewSheet.querySelectorAll<HTMLElement>('[data-source-line]');
    if (blocks.length === 0) {
      elPreviewScroller.scrollTop = ratio * maxPreviewScroll;
      return;
    }

    let prevBlock: HTMLElement = blocks[0];
    let nextBlock: HTMLElement = blocks[blocks.length - 1];
    let prevLine = 0;
    let nextLine = totalLines;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const ln = Number(b.getAttribute('data-source-line') || 0);
      if (ln <= targetLine) {
        prevBlock = b;
        prevLine = ln;
      }
      if (ln >= targetLine) {
        nextBlock = b;
        nextLine = ln;
        break;
      }
    }

    const sheetTop = elPreviewSheet.offsetTop;
    const prevTop = prevBlock.offsetTop + sheetTop - 24;
    const nextTop = nextBlock.offsetTop + sheetTop - 24;
    const span = Math.max(1, nextLine - prevLine);
    const localFrac = Math.min(1, Math.max(0, (targetLine - prevLine) / span));
    elPreviewScroller.scrollTop = prevTop + (nextTop - prevTop) * localFrac;
  },
  { passive: true }
);

elPreviewScroller.addEventListener(
  'scroll',
  () => {
    if (scrollLockSource === 'editor' || state.splitLayout !== 'split') return;
    lockScroll('preview');

    const maxPreviewScroll =
      elPreviewScroller.scrollHeight - elPreviewScroller.clientHeight;
    const maxEditorScroll =
      elEditorScroller.scrollHeight - elEditorScroller.clientHeight;
    if (maxPreviewScroll <= 0 || maxEditorScroll <= 0) return;

    const ratio = elPreviewScroller.scrollTop / maxPreviewScroll;
    if (ratio <= 0.01) {
      elEditorScroller.scrollTop = 0;
      return;
    }
    if (ratio >= 0.99) {
      elEditorScroller.scrollTop = maxEditorScroll;
      return;
    }

    const blocks = elPreviewSheet.querySelectorAll<HTMLElement>('[data-source-line]');
    const totalLines = Math.max(1, state.markdown.split('\n').length);
    const scrollTop = elPreviewScroller.scrollTop;
    const sheetTop = elPreviewSheet.offsetTop;

    let matchedLine = ratio * totalLines;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const top = b.offsetTop + sheetTop;
      if (top >= scrollTop) {
        matchedLine = Number(b.getAttribute('data-source-line') || 0);
        break;
      }
    }

    const lineRatio = Math.min(1, Math.max(0, matchedLine / totalLines));
    elEditorScroller.scrollTop = lineRatio * maxEditorScroll;
  },
  { passive: true }
);

/* ============================================================================
 * Engine B: Inline Live-Rendering Editor Mode (`Ctrl+E`)
 * ============================================================================ */
function renderEngineBInlineCanvas(): void {
  const blocks = splitIntoLogicalBlocks(state.markdown);
  elInlineCanvas.innerHTML = '';

  if (blocks.length === 0) {
    blocks.push({ startLine: 0, endLine: 1, raw: '# New Note', hash: 'init' });
  }

  blocks.forEach((blk, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'litemd-inline-block';

    if (state.activeInlineBlockIdx === idx) {
      wrapper.classList.add('is-editing');
      const badge = document.createElement('div');
      badge.className = 'litemd-inline-badge';
      badge.innerHTML = `
        <span>Editing Block #${idx + 1} (Lines ${blk.startLine + 1}–${blk.endLine}) · Slash commands: /math /matrix /align /table /code</span>
        <span>Esc or Click outside to render</span>
      `;

      const ta = document.createElement('textarea');
      ta.className = 'litemd-inline-textarea';
      ta.spellcheck = false;
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('autocorrect', 'off');
      ta.setAttribute('autocapitalize', 'off');
      ta.value = blk.raw;

      const autoSize = () => {
        ta.style.height = 'auto';
        ta.style.height = `${Math.max(46, ta.scrollHeight + 4)}px`;
      };

      const commitBlockChange = (newRaw: string) => {
        const updatedBlocks = blocks.map((b, i) => (i === idx ? newRaw : b.raw));
        state.markdown = updatedBlocks.join('\n\n');
        elTextarea.value = state.markdown;
        state.isDirty = true;
        syncToolbarAndTitle();
        syncEditorBackdropAndGutter();
      };

      ta.addEventListener('input', () => {
        autoSize();
        commitBlockChange(ta.value);
      });

      ta.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Tab' || ev.key === ' ') && tryExpandSlashCommand(ta)) {
          ev.preventDefault();
          autoSize();
          commitBlockChange(ta.value);
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          state.activeInlineBlockIdx = null;
          renderEngineBInlineCanvas();
          return;
        }
        if (ev.key === 'ArrowUp' && ta.selectionStart === 0 && idx > 0) {
          ev.preventDefault();
          state.activeInlineBlockIdx = idx - 1;
          renderEngineBInlineCanvas();
          return;
        }
        if (
          ev.key === 'ArrowDown' &&
          ta.selectionEnd === ta.value.length &&
          idx + 1 < blocks.length
        ) {
          ev.preventDefault();
          state.activeInlineBlockIdx = idx + 1;
          renderEngineBInlineCanvas();
          return;
        }
      });

      ta.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (state.activeInlineBlockIdx === idx) {
            state.activeInlineBlockIdx = null;
            renderEngineBInlineCanvas();
          }
        }, 120);
      });

      wrapper.appendChild(badge);
      wrapper.appendChild(ta);
      elInlineCanvas.appendChild(wrapper);
      requestAnimationFrame(() => {
        autoSize();
        ta.focus();
      });
    } else {
      wrapper.innerHTML = renderMarkdown(blk.raw);
      wrapper.title = 'Click to edit raw Markdown / LaTeX source in place';
      wrapper.addEventListener('click', (ev) => {
        // Ignore clicks on links or checkboxes
        const target = ev.target as HTMLElement;
        if (target.tagName === 'A' || target.tagName === 'INPUT') return;
        state.activeInlineBlockIdx = idx;
        renderEngineBInlineCanvas();
      });
      elInlineCanvas.appendChild(wrapper);
    }
  });

  // Tail button to append a new block in Engine B
  const addBtn = document.createElement('button');
  addBtn.className = 'litemd-btn';
  addBtn.style.marginTop = '14px';
  addBtn.textContent = '+ Append New Paragraph / Math Block';
  addBtn.addEventListener('click', () => {
    state.markdown = state.markdown.trimEnd() + '\n\nNew paragraph or $x_1 + x_2$...';
    elTextarea.value = state.markdown;
    state.isDirty = true;
    const newBlocks = splitIntoLogicalBlocks(state.markdown);
    state.activeInlineBlockIdx = newBlocks.length - 1;
    syncEditorBackdropAndGutter();
    renderEngineBInlineCanvas();
  });
  elInlineCanvas.appendChild(addBtn);
}

/* ============================================================================
 * Raw Editor Input & Slash-Command Listeners
 * ============================================================================ */
elTextarea.value = state.markdown;

elTextarea.addEventListener('input', () => {
  state.markdown = elTextarea.value;
  state.isDirty = true;
  syncEditorBackdropAndGutter();
  updateLivePreview();
  updateCursorStatus();
  syncToolbarAndTitle();
});

elTextarea.addEventListener('keydown', (ev) => {
  if (
    (ev.key === 'Tab' || ev.key === ' ' || ev.key === 'Enter') &&
    tryExpandSlashCommand(elTextarea)
  ) {
    ev.preventDefault();
    state.markdown = elTextarea.value;
    state.isDirty = true;
    syncEditorBackdropAndGutter();
    updateLivePreview();
    updateCursorStatus();
    syncToolbarAndTitle();
    return;
  }

  // Indent with 2 spaces on Tab
  if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey) {
    ev.preventDefault();
    const start = elTextarea.selectionStart;
    const end = elTextarea.selectionEnd;
    elTextarea.value =
      elTextarea.value.slice(0, start) + '  ' + elTextarea.value.slice(end);
    elTextarea.setSelectionRange(start + 2, start + 2);
    state.markdown = elTextarea.value;
    state.isDirty = true;
    syncEditorBackdropAndGutter();
    updateLivePreview();
    updateCursorStatus();
  }
});

elTextarea.addEventListener('click', updateCursorStatus);
elTextarea.addEventListener('keyup', updateCursorStatus);

/* ============================================================================
 * Resizable Split-Pane Divider
 * ============================================================================ */
let isDraggingDivider = false;

elSplitDivider.addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  isDraggingDivider = true;
  elSplitDivider.classList.add('is-dragging');
});

elSplitDivider.addEventListener('dblclick', () => {
  elPaneEditor.style.width = '50%';
  syncEditorBackdropAndGutter();
});

window.addEventListener('mousemove', (ev) => {
  if (!isDraggingDivider) return;
  const rect = elEngineA.getBoundingClientRect();
  const pct = Math.min(82, Math.max(18, ((ev.clientX - rect.left) / rect.width) * 100));
  elPaneEditor.style.width = `${pct.toFixed(1)}%`;
});

window.addEventListener('mouseup', () => {
  if (isDraggingDivider) {
    isDraggingDivider = false;
    elSplitDivider.classList.remove('is-dragging');
    syncEditorBackdropAndGutter();
  }
});

/* ============================================================================
 * Native File I/O Operations & External File-Watcher
 * ============================================================================ */
async function loadFileFromPath(path: string): Promise<void> {
  try {
    const content = await readMarkdownFile(path);
    const mtime = await getFileMtime(path);
    state.markdown = content;
    state.filePath = path;
    state.lastSavedMtime = mtime;
    state.isDirty = false;
    elTextarea.value = content;
    syncEditorBackdropAndGutter();
    updateLivePreview();
    syncToolbarAndTitle();
  } catch (err) {
    alert(`Could not read file "${path}":\n${String(err)}`);
  }
}

async function handleNewFile(): Promise<void> {
  if (state.isDirty && !confirm('Discard unsaved changes and start a new document?')) {
    return;
  }
  state.markdown = '# Untitled Note\n\nWrite Markdown and LaTeX math ($x_1 + x_2 = y$) here...\n';
  state.filePath = null;
  state.lastSavedMtime = 0;
  state.isDirty = false;
  elTextarea.value = state.markdown;
  syncEditorBackdropAndGutter();
  updateLivePreview();
  syncToolbarAndTitle();
  elTextarea.focus();
}

async function handleOpenFile(): Promise<void> {
  const picked = await pickOpenMarkdownFile();
  if (picked) {
    await loadFileFromPath(picked);
    return;
  }
  // Fallback prompt if running inside browser dev mode
  if (!('__TAURI_INTERNALS__' in window)) {
    const manualPath = prompt('Enter full path to .md file on D:\\:', 'D:\\projects\\TextEditor\\spec.md');
    if (manualPath) await loadFileFromPath(manualPath);
  }
}

async function handleSaveFile(forceSaveAs = false): Promise<void> {
  let targetPath = state.filePath;
  if (!targetPath || forceSaveAs) {
    const picked = await pickSaveMarkdownFile(
      state.filePath || 'D:\\projects\\TextEditor\\notes.md'
    );
    if (!picked) return;
    targetPath = picked;
  }

  try {
    const mtime = await saveMarkdownFile(targetPath, state.markdown);
    state.filePath = targetPath;
    state.lastSavedMtime = mtime;
    state.isDirty = false;
    syncToolbarAndTitle();
  } catch (err) {
    alert(`Failed to save "${targetPath}":\n${String(err)}`);
  }
}

// Lightweight external file modification watcher (polls metadata mtime when clean)
window.setInterval(async () => {
  if (!state.filePath || state.isDirty) return;
  const mtime = await getFileMtime(state.filePath);
  if (mtime > 0 && state.lastSavedMtime > 0 && mtime > state.lastSavedMtime) {
    const content = await readMarkdownFile(state.filePath);
    state.lastSavedMtime = mtime;
    if (content !== state.markdown) {
      state.markdown = content;
      elTextarea.value = content;
      syncEditorBackdropAndGutter();
      updateLivePreview();
      elStatusPerf.textContent = 'Auto-reloaded external edit from disk';
    }
  }
}, 1500);

/* ============================================================================
 * Direct "Click-to-Style" Preview Inspector Mode (spec.md Section 7.C)
 * ============================================================================ */
let hoveredInspectorEl: HTMLElement | null = null;

elPreviewSheet.addEventListener('mouseover', (ev) => {
  if (!state.inspectorActive) return;
  const target = (ev.target as HTMLElement).closest(
    'h1, h2, h3, h4, h5, h6, .litemd-math-block, .litemd-math-inline, blockquote, pre, code, table, p, .litemd-preview-sheet'
  ) as HTMLElement | null;
  if (hoveredInspectorEl && hoveredInspectorEl !== target) {
    hoveredInspectorEl.classList.remove('litemd-inspector-hover-target');
  }
  if (target) {
    target.classList.add('litemd-inspector-hover-target');
    hoveredInspectorEl = target;
  }
});

elPreviewSheet.addEventListener('mouseout', () => {
  if (hoveredInspectorEl) {
    hoveredInspectorEl.classList.remove('litemd-inspector-hover-target');
    hoveredInspectorEl = null;
  }
});

// Interactive GFM task-list checkbox toggling in the Preview Pane
elPreviewSheet.addEventListener('change', (ev) => {
  const target = ev.target as HTMLInputElement;
  if (!target || !target.classList.contains('litemd-task-checkbox')) return;
  const li = target.closest('li[data-line]');
  if (!li) return;
  const lineIdx = Number(li.getAttribute('data-line'));
  const lines = state.markdown.split('\n');
  if (lineIdx >= 0 && lineIdx < lines.length) {
    lines[lineIdx] = lines[lineIdx].replace(
      /^(\s*[-*+]\s+\[)[ xX](\])/,
      `$1${target.checked ? 'x' : ' '}$2`
    );
    state.markdown = lines.join('\n');
    elTextarea.value = state.markdown;
    state.isDirty = true;
    syncEditorBackdropAndGutter();
    updateLivePreview();
    syncToolbarAndTitle();
  }
});

elPreviewSheet.addEventListener('click', (ev) => {
  if (!state.inspectorActive) return;
  ev.preventDefault();
  ev.stopPropagation();

  const rawTarget = ev.target as HTMLElement;
  const target = rawTarget.closest(
    'h1, h2, h3, h4, h5, h6, .litemd-math-block, .litemd-math-inline, blockquote, pre, code, table, p, .litemd-preview-sheet'
  ) as HTMLElement | null;
  if (!target) return;

  openInspectorMiniPalette(target, ev.clientX, ev.clientY);
});

function openInspectorMiniPalette(target: HTMLElement, x: number, y: number): void {
  const tag = target.tagName.toLowerCase();
  const isMathBlock = target.classList.contains('litemd-math-block');
  const isMathInline = target.classList.contains('litemd-math-inline');

  let title = 'Paragraph & Body Typography';
  let controlsHtml = '';

  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
    const level = tag === 'h1' ? 'H1' : tag === 'h2' ? 'H2' : tag === 'h3' ? 'H3' : 'H4';
    const propKey = `preview${level}Color` as keyof LiteMDThemeConfig;
    title = `${tag.toUpperCase()} Heading Style`;
    controlsHtml = `
      <div class="litemd-control-row">
        <label>${tag.toUpperCase()} Text Color</label>
        <input type="color" data-inspect-color="${propKey}" value="${String(state.theme[propKey])}" />
      </div>
      <div class="litemd-control-row">
        <label>Header Underline Accent</label>
        <input type="color" data-inspect-color="previewHeadingBorderColor" value="${state.theme.previewHeadingBorderColor}" />
      </div>
      <div class="litemd-control-row">
        <label>Section Top Spacing</label>
        <input type="range" min="0.6" max="3.0" step="0.05" data-inspect-num="previewSectionSpacingEm" value="${state.theme.previewSectionSpacingEm}" />
      </div>
    `;
  } else if (isMathBlock || isMathInline) {
    title = isMathBlock ? 'Display Math Block ($$ / \\[...\\])' : 'Inline Math ($...$)';
    controlsHtml = `
      <div class="litemd-control-row">
        <label>Math Ink Color</label>
        <input type="color" data-inspect-color="previewMathColor" value="${state.theme.previewMathColor}" />
      </div>
      <div class="litemd-control-row">
        <label>Display Box Background</label>
        <input type="color" data-inspect-color="previewMathBg" value="${state.theme.previewMathBg}" />
      </div>
      <div class="litemd-control-row">
        <label>Display Box Border</label>
        <input type="color" data-inspect-color="previewMathBorder" value="${state.theme.previewMathBorder}" />
      </div>
      <div class="litemd-control-row">
        <label>Math Scale (0.85x–1.35x)</label>
        <input type="range" min="0.85" max="1.35" step="0.05" data-inspect-num="previewMathScale" value="${state.theme.previewMathScale}" />
      </div>
    `;
  } else if (tag === 'blockquote') {
    title = 'Blockquote Callout Style';
    controlsHtml = `
      <div class="litemd-control-row">
        <label>Accent Bar Color</label>
        <input type="color" data-inspect-color="previewQuoteBorder" value="${state.theme.previewQuoteBorder}" />
      </div>
      <div class="litemd-control-row">
        <label>Quote Background</label>
        <input type="color" data-inspect-color="previewQuoteBg" value="${state.theme.previewQuoteBg}" />
      </div>
    `;
  } else if (tag === 'code' || tag === 'pre') {
    title = 'Code Block & Inline Code Pill';
    controlsHtml = `
      <div class="litemd-control-row">
        <label>Inline Code Text</label>
        <input type="color" data-inspect-color="previewInlineCodeColor" value="${state.theme.previewInlineCodeColor}" />
      </div>
      <div class="litemd-control-row">
        <label>Inline Code Pill Bg</label>
        <input type="color" data-inspect-color="previewInlineCodeBg" value="${state.theme.previewInlineCodeBg}" />
      </div>
    `;
  } else if (tag === 'table') {
    title = 'GFM Table Styling';
    controlsHtml = `
      <div class="litemd-control-row">
        <label>Table Grid Border</label>
        <input type="color" data-inspect-color="previewTableBorder" value="${state.theme.previewTableBorder}" />
      </div>
      <div class="litemd-control-row">
        <label>Alternating Row Stripe</label>
        <input type="color" data-inspect-color="previewTableStripe" value="${state.theme.previewTableStripe}" />
      </div>
    `;
  } else {
    controlsHtml = `
      <div class="litemd-control-row">
        <label>Page Canvas Background</label>
        <input type="color" data-inspect-color="previewCanvasBg" value="${state.theme.previewCanvasBg}" />
      </div>
      <div class="litemd-control-row">
        <label>Primary Body Text</label>
        <input type="color" data-inspect-color="previewBodyColor" value="${state.theme.previewBodyColor}" />
      </div>
      <div class="litemd-control-row">
        <label>Base Font Size (px)</label>
        <input type="range" min="13" max="24" step="0.5" data-inspect-num="previewFontSizePx" value="${state.theme.previewFontSizePx}" />
      </div>
      <div class="litemd-control-row">
        <label>Line Height</label>
        <input type="range" min="1.3" max="2.2" step="0.02" data-inspect-num="previewLineHeight" value="${state.theme.previewLineHeight}" />
      </div>
      <div class="litemd-control-row">
        <label>Horizontal Page Margin</label>
        <input type="range" min="16" max="120" step="2" data-inspect-num="previewMarginXPx" value="${state.theme.previewMarginXPx}" />
      </div>
    `;
  }

  elInspectorTitle.textContent = title;
  elInspectorControls.innerHTML = controlsHtml;
  elInspectorPopover.classList.add('is-open');

  const clampedX = Math.min(window.innerWidth - 310, Math.max(12, x + 12));
  const clampedY = Math.min(window.innerHeight - 230, Math.max(48, y + 8));
  elInspectorPopover.style.left = `${clampedX}px`;
  elInspectorPopover.style.top = `${clampedY}px`;

  // Bind live 60fps listeners inside the popover
  elInspectorControls.querySelectorAll<HTMLInputElement>('[data-inspect-color]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const key = inp.getAttribute('data-inspect-color') as keyof LiteMDThemeConfig;
      if (key.startsWith('previewH') && key !== 'previewHeadingBorderColor') {
        state.theme.unifyHeadingColors = false;
      }
      (state.theme as unknown as Record<string, unknown>)[key] = inp.value;
      applyThemeToDOM(state.theme);
      renderStudioDrawerControls();
    });
  });

  elInspectorControls.querySelectorAll<HTMLInputElement>('[data-inspect-num]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const key = inp.getAttribute('data-inspect-num') as keyof LiteMDThemeConfig;
      (state.theme as unknown as Record<string, unknown>)[key] = Number(inp.value);
      applyThemeToDOM(state.theme);
      renderStudioDrawerControls();
    });
  });
}

document.getElementById('inspector-close')!.addEventListener('click', () => {
  elInspectorPopover.classList.remove('is-open');
});

/* ============================================================================
 * Slide-Out Theme, Typography & Layout Studio Drawer (spec.md Section 7)
 * ============================================================================ */
function buildFontSelectOptions(
  options: Array<{ label: string; value: string }>,
  current: string
): string {
  return options
    .map(
      (o) =>
        `<option value='${o.value}' ${
          o.value === current ? 'selected' : ''
        }>${o.label}</option>`
    )
    .join('');
}

async function refreshCustomThemesFromD(): Promise<void> {
  const entries = await listCustomThemesOnD();
  const nextCustom: Record<string, LiteMDThemeConfig> = {};
  for (const [fileStem, jsonText] of entries) {
    try {
      const parsed = JSON.parse(jsonText) as Partial<LiteMDThemeConfig>;
      if (parsed && typeof parsed === 'object') {
        const merged = {
          ...cloneTheme(THEME_PRESETS['latex-academic']),
          ...parsed,
          id: `custom:${fileStem}`,
          name: parsed.name || fileStem,
        };
        nextCustom[merged.id] = merged;
      }
    } catch {
      // Ignore malformed custom theme JSON
    }
  }
  state.customThemes = nextCustom;
  if (state.studioOpen) {
    renderStudioDrawerControls();
  }
}

function renderStudioDrawerControls(): void {
  const t = state.theme;
  const allPresets = [
    ...Object.values(THEME_PRESETS),
    ...Object.values(state.customThemes),
  ];
  elStudioBody.innerHTML = `
    <!-- Section 1: One-Click Theme Presets & D:\ JSON Persistence -->
    <div class="litemd-studio-section">
      <div class="litemd-studio-section-title">1. Built-In & Custom Theme Presets</div>
      <div class="litemd-preset-grid">
        ${allPresets
          .map(
            (p) => `
          <button class="litemd-preset-card ${
            t.id === p.id ? 'is-active' : ''
          }" data-preset-id="${p.id}">
            <strong>${p.name}</strong>
          </button>
        `
          )
          .join('')}
      </div>
      <div class="litemd-control-row" style="margin-top: 10px;">
        <input type="text" id="custom-theme-name" placeholder="my-academic-theme" value="${t.name
          .toLowerCase()
          .replace(/\s+/g, '-')}" style="flex:1;max-width:none;" />
        <button class="litemd-btn" id="btn-save-theme-d" title="Save custom theme JSON to D:\\projects\\TextEditor\\themes\\">Save JSON on D:\\</button>
      </div>
      <div id="saved-themes-status" style="font-size:11px;color:#38bdf8;margin-top:4px;"></div>
    </div>

    <!-- Section 2: Rendered Preview Typography -->
    <div class="litemd-studio-section">
      <div class="litemd-studio-section-title">2. Preview Typography</div>
      <div class="litemd-control-row">
        <label>Body Font</label>
        <select data-theme-str="previewFontBody">
          ${buildFontSelectOptions(FONT_OPTIONS.body, t.previewFontBody)}
        </select>
      </div>
      <div class="litemd-control-row">
        <label>Heading Font</label>
        <select data-theme-str="previewFontHeading">
          ${buildFontSelectOptions(FONT_OPTIONS.heading, t.previewFontHeading)}
        </select>
      </div>
      <div class="litemd-control-row">
        <label>Code Font</label>
        <select data-theme-str="previewFontCode">
          ${buildFontSelectOptions(FONT_OPTIONS.code, t.previewFontCode)}
        </select>
      </div>
      <div class="litemd-control-row">
        <label>Math Font</label>
        <select data-theme-str="previewFontMath">
          ${buildFontSelectOptions(FONT_OPTIONS.math, t.previewFontMath)}
        </select>
      </div>
      <div class="litemd-control-row">
        <label>Base Font Size</label>
        <input type="range" min="13" max="24" step="0.5" data-theme-num="previewFontSizePx" value="${t.previewFontSizePx}" />
        <span class="litemd-val-badge" data-badge="previewFontSizePx">${t.previewFontSizePx}px</span>
      </div>
      <div class="litemd-control-row">
        <label>Line Height</label>
        <input type="range" min="1.3" max="2.2" step="0.02" data-theme-num="previewLineHeight" value="${t.previewLineHeight}" />
        <span class="litemd-val-badge" data-badge="previewLineHeight">${t.previewLineHeight}</span>
      </div>
      <div class="litemd-control-row">
        <label>Letter Spacing</label>
        <input type="range" min="-0.03" max="0.08" step="0.005" data-theme-num="previewLetterSpacingEm" value="${t.previewLetterSpacingEm}" />
        <span class="litemd-val-badge" data-badge="previewLetterSpacingEm">${t.previewLetterSpacingEm}em</span>
      </div>
      <div class="litemd-control-row">
        <label>Paragraph Spacing</label>
        <input type="range" min="0.4" max="2.2" step="0.05" data-theme-num="previewParaSpacingEm" value="${t.previewParaSpacingEm}" />
        <span class="litemd-val-badge" data-badge="previewParaSpacingEm">${t.previewParaSpacingEm}em</span>
      </div>
      <div class="litemd-control-row">
        <label>Math Scale</label>
        <input type="range" min="0.85" max="1.35" step="0.02" data-theme-num="previewMathScale" value="${t.previewMathScale}" />
        <span class="litemd-val-badge" data-badge="previewMathScale">${t.previewMathScale}x</span>
      </div>
    </div>

    <!-- Section 3: Page Geometry & Margins -->
    <div class="litemd-studio-section">
      <div class="litemd-studio-section-title">3. Page Geometry & Margins</div>
      <div class="litemd-control-row">
        <label>Top / Bottom Margin</label>
        <input type="range" min="16" max="96" step="2" data-theme-num="previewMarginYPx" value="${t.previewMarginYPx}" />
        <span class="litemd-val-badge" data-badge="previewMarginYPx">${t.previewMarginYPx}px</span>
      </div>
      <div class="litemd-control-row">
        <label>Left / Right Margin</label>
        <input type="range" min="16" max="120" step="2" data-theme-num="previewMarginXPx" value="${t.previewMarginXPx}" />
        <span class="litemd-val-badge" data-badge="previewMarginXPx">${t.previewMarginXPx}px</span>
      </div>
      <div class="litemd-control-row">
        <label>Max Readable Width</label>
        <input type="range" min="540" max="1400" step="20" data-theme-num="previewMaxWidthPx" value="${t.previewMaxWidthPx}" />
        <span class="litemd-val-badge" data-badge="previewMaxWidthPx">${t.previewMaxWidthPx}px</span>
      </div>
      <div class="litemd-control-row">
        <label>Section Spacing</label>
        <input type="range" min="0.8" max="3.0" step="0.05" data-theme-num="previewSectionSpacingEm" value="${t.previewSectionSpacingEm}" />
        <span class="litemd-val-badge" data-badge="previewSectionSpacingEm">${t.previewSectionSpacingEm}em</span>
      </div>
    </div>

    <!-- Section 4: Granular Color Palette -->
    <div class="litemd-studio-section">
      <div class="litemd-studio-section-title">4. Granular Preview Color Palette</div>
      <div class="litemd-control-row">
        <label>Page Canvas Background</label>
        <input type="color" data-theme-str="previewCanvasBg" value="${t.previewCanvasBg}" />
      </div>
      <div class="litemd-control-row">
        <label>Outer Workspace Bg</label>
        <input type="color" data-theme-str="previewWorkspaceBg" value="${t.previewWorkspaceBg}" />
      </div>
      <div class="litemd-control-row">
        <label>Primary Body Font Color</label>
        <input type="color" data-theme-str="previewBodyColor" value="${t.previewBodyColor}" />
      </div>
      <div class="litemd-control-row">
        <label>Secondary / Muted Text</label>
        <input type="color" data-theme-str="previewMutedColor" value="${t.previewMutedColor}" />
      </div>
      <div class="litemd-control-row">
        <label>Unify All Heading Colors</label>
        <input type="checkbox" id="chk-unify-headings" ${t.unifyHeadingColors ? 'checked' : ''} />
      </div>
      <div class="litemd-control-row">
        <label>H1 Color / Unified</label>
        <input type="color" data-theme-str="previewH1Color" value="${t.previewH1Color}" />
        <label>H2</label>
        <input type="color" data-theme-str="previewH2Color" value="${t.previewH2Color}" />
      </div>
      <div class="litemd-control-row">
        <label>H3 Color</label>
        <input type="color" data-theme-str="previewH3Color" value="${t.previewH3Color}" />
        <label>H4–H6</label>
        <input type="color" data-theme-str="previewH4Color" value="${t.previewH4Color}" />
      </div>
      <div class="litemd-control-row">
        <label>Header Bottom Border</label>
        <input type="color" data-theme-str="previewHeadingBorderColor" value="${t.previewHeadingBorderColor}" />
      </div>
      <div class="litemd-control-row">
        <label>Math Equations Text</label>
        <input type="color" data-theme-str="previewMathColor" value="${t.previewMathColor}" />
      </div>
      <div class="litemd-control-row">
        <label>Display Math Box Bg</label>
        <input type="color" data-theme-str="previewMathBg" value="${t.previewMathBg}" />
        <label>Border</label>
        <input type="color" data-theme-str="previewMathBorder" value="${t.previewMathBorder}" />
      </div>
      <div class="litemd-control-row">
        <label>Blockquote Bar</label>
        <input type="color" data-theme-str="previewQuoteBorder" value="${t.previewQuoteBorder}" />
        <label>Quote Bg</label>
        <input type="color" data-theme-str="previewQuoteBg" value="${t.previewQuoteBg}" />
      </div>
      <div class="litemd-control-row">
        <label>Inline Code Pill</label>
        <input type="color" data-theme-str="previewInlineCodeColor" value="${t.previewInlineCodeColor}" />
        <label>Pill Bg</label>
        <input type="color" data-theme-str="previewInlineCodeBg" value="${t.previewInlineCodeBg}" />
      </div>
      <div class="litemd-control-row">
        <label>Links</label>
        <input type="color" data-theme-str="previewLinkColor" value="${t.previewLinkColor}" />
        <label>Table Grid</label>
        <input type="color" data-theme-str="previewTableBorder" value="${t.previewTableBorder}" />
      </div>
    </div>

    <!-- Section 5: Raw Editor & Intelligent Soft-Wrapping -->
    <div class="litemd-studio-section">
      <div class="litemd-studio-section-title">5. Raw Editor & Soft-Wrap Studio</div>
      <div class="litemd-control-row">
        <label>Soft-Wrap Column Width</label>
        <input type="range" min="60" max="130" step="2" data-theme-num="editorWrapColumnCh" value="${t.editorWrapColumnCh}" />
        <span class="litemd-val-badge" data-badge="editorWrapColumnCh">${t.editorWrapColumnCh}ch</span>
      </div>
      <div class="litemd-control-row">
        <label>Editor Font Size</label>
        <input type="range" min="12" max="22" step="0.5" data-theme-num="editorFontSizePx" value="${t.editorFontSizePx}" />
        <span class="litemd-val-badge" data-badge="editorFontSizePx">${t.editorFontSizePx}px</span>
      </div>
      <div class="litemd-control-row">
        <label>Editor Line Height</label>
        <input type="range" min="1.35" max="2.1" step="0.05" data-theme-num="editorLineHeight" value="${t.editorLineHeight}" />
        <span class="litemd-val-badge" data-badge="editorLineHeight">${t.editorLineHeight}</span>
      </div>
      <div class="litemd-control-row">
        <label>Editor Background</label>
        <input type="color" data-theme-str="editorBg" value="${t.editorBg}" />
        <label>Text</label>
        <input type="color" data-theme-str="editorFg" value="${t.editorFg}" />
      </div>
      <div class="litemd-control-row">
        <label># Heading Token</label>
        <input type="color" data-theme-str="syntaxHeadingColor" value="${t.syntaxHeadingColor}" />
        <label>$Math$ Token</label>
        <input type="color" data-theme-str="syntaxMathFgColor" value="${t.syntaxMathFgColor}" />
      </div>
    </div>
  `;

  // Preset cards (built-in + custom themes saved on D:\)
  elStudioBody.querySelectorAll<HTMLButtonElement>('[data-preset-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const presetId = btn.getAttribute('data-preset-id')!;
      const chosen = THEME_PRESETS[presetId] || state.customThemes[presetId];
      if (chosen) {
        state.theme = cloneTheme(chosen);
        applyThemeToDOM(state.theme);
        syncEditorBackdropAndGutter();
        syncToolbarAndTitle();
        renderStudioDrawerControls();
      }
    });
  });

  // Save custom theme JSON to D:\
  document.getElementById('btn-save-theme-d')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('custom-theme-name') as HTMLInputElement;
    const rawName = (nameInput?.value || 'custom-theme').trim();
    const themeToSave: LiteMDThemeConfig = {
      ...cloneTheme(state.theme),
      id: `custom:${rawName}`,
      name: rawName,
    };
    const jsonStr = JSON.stringify(themeToSave, null, 2);
    const savedPath = await saveCustomThemeOnD(rawName, jsonStr);
    await refreshCustomThemesFromD();
    const statusEl = document.getElementById('saved-themes-status');
    if (statusEl) {
      statusEl.textContent = `✓ Saved to ${savedPath}`;
    }
  });

  // Unify heading colors checkbox
  document.getElementById('chk-unify-headings')?.addEventListener('change', (ev) => {
    state.theme.unifyHeadingColors = (ev.target as HTMLInputElement).checked;
    state.theme.previewHeadingUnifiedColor = state.theme.previewH1Color;
    applyThemeToDOM(state.theme);
  });

  // String / color inputs
  elStudioBody.querySelectorAll<HTMLElement>('[data-theme-str]').forEach((el) => {
    el.addEventListener('input', () => {
      const key = el.getAttribute('data-theme-str') as keyof LiteMDThemeConfig;
      const val = (el as HTMLInputElement | HTMLSelectElement).value;
      (state.theme as unknown as Record<string, unknown>)[key] = val;
      if (key === 'previewH1Color' && state.theme.unifyHeadingColors) {
        state.theme.previewHeadingUnifiedColor = val;
      }
      applyThemeToDOM(state.theme);
    });
  });

  // Numeric scrubbers
  elStudioBody.querySelectorAll<HTMLInputElement>('[data-theme-num]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const key = inp.getAttribute('data-theme-num') as keyof LiteMDThemeConfig;
      const numVal = Number(inp.value);
      (state.theme as unknown as Record<string, unknown>)[key] = numVal;
      const badge = elStudioBody.querySelector(`[data-badge="${key}"]`);
      if (badge) {
        const suffix = key.endsWith('Px')
          ? 'px'
          : key.endsWith('Em')
          ? 'em'
          : key.endsWith('Ch')
          ? 'ch'
          : key === 'previewMathScale'
          ? 'x'
          : '';
        badge.textContent = `${numVal}${suffix}`;
      }
      applyThemeToDOM(state.theme);
      if (
        key === 'editorWrapColumnCh' ||
        key === 'editorFontSizePx' ||
        key === 'editorLineHeight'
      ) {
        syncEditorBackdropAndGutter();
      }
    });
  });
}

/* ============================================================================
 * Toolbar Button Actions & Global Keyboard Shortcuts (spec.md Section 5)
 * ============================================================================ */
function toggleSplitView(): void {
  state.engineMode = 'engine-a';
  state.splitLayout = state.splitLayout === 'split' ? 'editor-only' : 'split';
  syncToolbarAndTitle();
  syncEditorBackdropAndGutter();
  updateLivePreview();
}

function toggleReaderMode(): void {
  state.engineMode = 'engine-a';
  state.splitLayout =
    state.splitLayout === 'preview-only' ? 'split' : 'preview-only';
  syncToolbarAndTitle();
  updateLivePreview();
}

function toggleEditorOnlyMode(): void {
  state.engineMode = 'engine-a';
  state.splitLayout =
    state.splitLayout === 'editor-only' ? 'split' : 'editor-only';
  syncToolbarAndTitle();
  syncEditorBackdropAndGutter();
}

function toggleEngineB(): void {
  state.engineMode = state.engineMode === 'engine-a' ? 'engine-b' : 'engine-a';
  state.activeInlineBlockIdx = null;
  syncToolbarAndTitle();
  updateLivePreview();
}

function toggleLightDarkTheme(): void {
  const nextPreset = state.theme.isDark ? 'latex-academic' : 'dark-oled';
  state.theme = cloneTheme(THEME_PRESETS[nextPreset]);
  applyThemeToDOM(state.theme);
  syncEditorBackdropAndGutter();
  if (state.studioOpen) renderStudioDrawerControls();
}

function toggleStudioDrawer(): void {
  state.studioOpen = !state.studioOpen;
  if (state.studioOpen) renderStudioDrawerControls();
  syncToolbarAndTitle();
}

function zoomFontSize(delta: number, reset = false): void {
  if (reset) {
    state.theme.previewFontSizePx = 17;
    state.theme.editorFontSizePx = 14.5;
  } else {
    state.theme.previewFontSizePx = Math.min(28, Math.max(11, state.theme.previewFontSizePx + delta));
    state.theme.editorFontSizePx = Math.min(24, Math.max(10, state.theme.editorFontSizePx + delta));
  }
  applyThemeToDOM(state.theme);
  syncEditorBackdropAndGutter();
  if (state.studioOpen) renderStudioDrawerControls();
}

document.getElementById('btn-new')!.addEventListener('click', () => void handleNewFile());
document.getElementById('btn-open')!.addEventListener('click', () => void handleOpenFile());
document.getElementById('btn-save')!.addEventListener('click', () => void handleSaveFile(false));
document.getElementById('btn-save-as')!.addEventListener('click', () => void handleSaveFile(true));
document.getElementById('btn-print')!.addEventListener('click', () => window.print());

elBtnSplit.addEventListener('click', () => {
  state.engineMode = 'engine-a';
  state.splitLayout = 'split';
  syncToolbarAndTitle();
  syncEditorBackdropAndGutter();
  updateLivePreview();
});
elBtnReader.addEventListener('click', toggleReaderMode);
elBtnEditor.addEventListener('click', toggleEditorOnlyMode);
elBtnEngineB.addEventListener('click', toggleEngineB);

elBtnSoftWrap.addEventListener('click', () => {
  state.theme.editorSoftWrapEnabled = !state.theme.editorSoftWrapEnabled;
  applyThemeToDOM(state.theme);
  syncToolbarAndTitle();
  syncEditorBackdropAndGutter();
});

elBtnLineNums.addEventListener('click', () => {
  state.showLineNumbers = !state.showLineNumbers;
  syncToolbarAndTitle();
  syncEditorBackdropAndGutter();
});

elBtnInspector.addEventListener('click', () => {
  state.inspectorActive = !state.inspectorActive;
  if (!state.inspectorActive) {
    elInspectorPopover.classList.remove('is-open');
  } else if (state.engineMode !== 'engine-a' || state.splitLayout === 'editor-only') {
    state.engineMode = 'engine-a';
    state.splitLayout = 'split';
  }
  syncToolbarAndTitle();
});

document.getElementById('btn-theme-toggle')!.addEventListener('click', toggleLightDarkTheme);
elBtnStudio.addEventListener('click', toggleStudioDrawer);
document.getElementById('studio-close')!.addEventListener('click', toggleStudioDrawer);

// Global Keyboard Shortcuts (spec.md Section 5)
window.addEventListener('keydown', (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (!ctrl) return;

  const key = ev.key.toLowerCase();

  if (key === 'n' && !ev.shiftKey) {
    ev.preventDefault();
    void handleNewFile();
  } else if (key === 'o' && !ev.shiftKey) {
    ev.preventDefault();
    void handleOpenFile();
  } else if (key === 's') {
    ev.preventDefault();
    void handleSaveFile(ev.shiftKey);
  } else if (key === '\\') {
    ev.preventDefault();
    toggleSplitView();
  } else if (key === 'v' && ev.shiftKey) {
    ev.preventDefault();
    toggleReaderMode();
  } else if (key === 'e' && ev.shiftKey) {
    ev.preventDefault();
    toggleEditorOnlyMode();
  } else if (key === 'e' && !ev.shiftKey) {
    ev.preventDefault();
    toggleEngineB();
  } else if (key === 't' && ev.shiftKey) {
    ev.preventDefault();
    toggleLightDarkTheme();
  } else if (key === ',') {
    ev.preventDefault();
    toggleStudioDrawer();
  } else if (key === 'p' && !ev.shiftKey) {
    ev.preventDefault();
    window.print();
  } else if (key === '=' || key === '+') {
    ev.preventDefault();
    zoomFontSize(1);
  } else if (key === '-') {
    ev.preventDefault();
    zoomFontSize(-1);
  } else if (key === '0') {
    ev.preventDefault();
    zoomFontSize(0, true);
  }
});

// Keep soft-wrap line numbers synchronized on window or split-pane resize
if (typeof ResizeObserver !== 'undefined') {
  const editorResizeObserver = new ResizeObserver(() => {
    syncEditorBackdropAndGutter();
  });
  editorResizeObserver.observe(elEditorStage);
}

// Frame-1 Initialization
syncToolbarAndTitle();
syncEditorBackdropAndGutter();
updateLivePreview();
updateCursorStatus();

// Check for CLI file argument (`litemd notes.md`) immediately after initial paint
requestAnimationFrame(async () => {
  const cliFile = await getCliFileArg();
  if (cliFile) {
    await loadFileFromPath(cliFile);
  }
  await refreshCustomThemesFromD();
});
