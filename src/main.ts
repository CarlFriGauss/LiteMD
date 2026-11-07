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
  buildLineMeasurerHtml,
  replaceTextareaRangeUndoable,
  replaceBlockSource,
  tryExpandSlashCommand,
} from './lib/editorHelpers';
import { EditorMirror } from './lib/editorMirror';
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
  saveSessionStateOnD,
  loadSessionStateFromD,
  openExternalUrl,
  registerWindowCloseGuard,
  updateNativeWindowTitle,
} from './lib/tauriBridge';

type EngineMode = 'engine-a' | 'engine-b';
type SplitLayoutMode = 'split' | 'preview-only' | 'editor-only';

interface DocumentTab {
  id: string;
  title: string;
  filePath: string | null;
  lastSavedMtime: number;
  isDirty: boolean;
  markdown: string;
  selectionStart: number;
  selectionEnd: number;
  editorScrollTop: number;
  previewScrollTop: number;
  renderedBlocks: LogicalBlock[];
}

interface AppState {
  tabs: DocumentTab[];
  activeTabId: string;
  nextTabSeq: number;
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

const initialTab: DocumentTab = {
  id: 'tab-1',
  title: 'Untitled-1.md',
  filePath: null,
  lastSavedMtime: 0,
  isDirty: false,
  markdown: DEFAULT_DOCUMENT,
  selectionStart: 0,
  selectionEnd: 0,
  editorScrollTop: 0,
  previewScrollTop: 0,
  renderedBlocks: [],
};

const state: AppState = {
  tabs: [initialTab],
  activeTabId: initialTab.id,
  nextTabSeq: 2,
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
      <button class="litemd-btn" id="btn-new" title="New Tab (Ctrl+T / Ctrl+N)">New Tab</button>
      <button class="litemd-btn" id="btn-open" title="Open Markdown File in Tab (Ctrl+O)">Open…</button>
      <button class="litemd-btn" id="btn-save" title="Save File (Ctrl+S)">Save</button>
      <button class="litemd-btn" id="btn-save-as" title="Save As… (Ctrl+Shift+S)">Save As</button>
      <button class="litemd-btn" id="btn-print" title="Export / Print Clean PDF (Ctrl+P)">PDF</button>
      <div class="litemd-file-pill" id="file-pill" title="Current File Path">
        <span class="litemd-dirty-dot" id="dirty-dot"></span>
        <span id="file-label">Untitled-1.md</span>
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

  <!-- Multi-Document Tab Strip -->
  <nav class="litemd-tabbar" id="tabbar" aria-label="Open Document Tabs"></nav>

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
            <pre class="litemd-editor-backdrop" id="editor-backdrop" dir="auto" aria-hidden="true"></pre>
            <textarea
              class="litemd-editor-textarea"
              id="editor-textarea"
              dir="auto"
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
        <article class="litemd-preview-sheet" id="preview-sheet" dir="auto"></article>
      </div>
    </section>

    <!-- ENGINE B: Inline Live-Rendering Editor Mode (Block/Line WYSIWYG) -->
    <section class="litemd-engine-b litemd-classic-scroll" id="engine-b">
      <div class="litemd-inline-canvas litemd-preview-sheet" id="inline-canvas" dir="auto"></div>
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
      <span id="status-perf">Render: ready</span>
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
const elTabBar = document.getElementById('tabbar')!;

const SESSION_STORAGE_KEY = 'litemd_session_v1';
let sessionPersistTimer = 0;
let isRestoringSession = false;

interface PersistedSessionV1 {
  version: 1;
  activeTabId: string;
  nextTabSeq: number;
  engineMode: EngineMode;
  splitLayout: SplitLayoutMode;
  showLineNumbers: boolean;
  theme: LiteMDThemeConfig;
  tabs: Array<{
    id: string;
    title: string;
    filePath: string | null;
    lastSavedMtime: number;
    isDirty: boolean;
    markdown: string;
    selectionStart: number;
    selectionEnd: number;
    editorScrollTop: number;
    previewScrollTop: number;
  }>;
}

function serializeSessionState(): string {
  const payload: PersistedSessionV1 = {
    version: 1,
    activeTabId: state.activeTabId,
    nextTabSeq: state.nextTabSeq,
    engineMode: state.engineMode,
    splitLayout: state.splitLayout,
    showLineNumbers: state.showLineNumbers,
    theme: state.theme,
    tabs: state.tabs.map((t) => ({
      id: t.id,
      title: t.title,
      filePath: t.filePath,
      lastSavedMtime: t.lastSavedMtime,
      isDirty: t.isDirty,
      markdown: t.markdown,
      selectionStart: t.selectionStart,
      selectionEnd: t.selectionEnd,
      editorScrollTop: t.editorScrollTop,
      previewScrollTop: t.previewScrollTop,
    })),
  };
  return JSON.stringify(payload);
}

let sessionSaveQueue: Promise<void> = Promise.resolve();

function flushSessionNow(syncOnly = false): Promise<void> {
  if (isRestoringSession) return Promise.resolve();
  saveActiveTabSnapshot();
  const json = serializeSessionState();
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, json);
  } catch {
    // Ignore storage quota errors
  }
  if (!syncOnly) {
    sessionSaveQueue = sessionSaveQueue.then(() => saveSessionStateOnD(json));
  }
  return sessionSaveQueue;
}

function scheduleSessionPersist(): void {
  if (isRestoringSession) return;
  window.clearTimeout(sessionPersistTimer);
  sessionPersistTimer = window.setTimeout(() => {
    flushSessionNow(false);
  }, 180);
}

function applyPersistedSessionJson(rawJson: string): boolean {
  try {
    const parsed = JSON.parse(rawJson) as Partial<PersistedSessionV1>;
    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return false;
    }
    isRestoringSession = true;
    state.tabs = parsed.tabs.map((t, i) => ({
      id: t.id || `tab-${i + 1}`,
      title: t.title || `Untitled-${i + 1}.md`,
      filePath: t.filePath ?? null,
      lastSavedMtime: Number(t.lastSavedMtime) || 0,
      isDirty: Boolean(t.isDirty),
      markdown: typeof t.markdown === 'string' ? t.markdown : '',
      selectionStart: Number(t.selectionStart) || 0,
      selectionEnd: Number(t.selectionEnd) || 0,
      editorScrollTop: Number(t.editorScrollTop) || 0,
      previewScrollTop: Number(t.previewScrollTop) || 0,
      renderedBlocks: [],
    }));
    state.nextTabSeq = Math.max(
      Number(parsed.nextTabSeq) || 2,
      state.tabs.length + 1
    );
    const active =
      state.tabs.find((t) => t.id === parsed.activeTabId) || state.tabs[0];
    state.activeTabId = active.id;
    state.markdown = active.markdown;
    state.filePath = active.filePath;
    state.lastSavedMtime = active.lastSavedMtime;
    state.isDirty = active.isDirty;
    state.renderedBlocks = [];

    if (parsed.engineMode === 'engine-a' || parsed.engineMode === 'engine-b') {
      state.engineMode = parsed.engineMode;
    }
    if (
      parsed.splitLayout === 'split' ||
      parsed.splitLayout === 'preview-only' ||
      parsed.splitLayout === 'editor-only'
    ) {
      state.splitLayout = parsed.splitLayout;
    }
    if (typeof parsed.showLineNumbers === 'boolean') {
      state.showLineNumbers = parsed.showLineNumbers;
    }
    if (parsed.theme && typeof parsed.theme === 'object') {
      state.theme = {
        ...cloneTheme(THEME_PRESETS['latex-academic']),
        ...parsed.theme,
      };
      applyThemeToDOM(state.theme);
    }

    elTextarea.value = state.markdown;
    elPreviewSheet.innerHTML = '';
    syncEditorBackdropAndGutter();
    updateLivePreview();
    syncToolbarAndTitle();

    requestAnimationFrame(() => {
      elTextarea.setSelectionRange(active.selectionStart, active.selectionEnd);
      elEditorScroller.scrollTop = active.editorScrollTop;
      elPreviewScroller.scrollTop = active.previewScrollTop;
      updateCursorStatus();
    });
    isRestoringSession = false;
    return true;
  } catch {
    isRestoringSession = false;
    return false;
  }
}

function getActiveTab(): DocumentTab {
  return state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0];
}

function saveActiveTabSnapshot(): void {
  const tab = getActiveTab();
  if (!tab) return;
  tab.markdown = state.markdown;
  tab.filePath = state.filePath;
  tab.lastSavedMtime = state.lastSavedMtime;
  tab.isDirty = state.isDirty;
  tab.title = state.filePath
    ? state.filePath.split(/[\\/]/).pop() || state.filePath
    : tab.title;
  tab.selectionStart = elTextarea.selectionStart || 0;
  tab.selectionEnd = elTextarea.selectionEnd || 0;
  tab.editorScrollTop = elEditorScroller.scrollTop;
  tab.previewScrollTop = elPreviewScroller.scrollTop;
  tab.renderedBlocks = state.renderedBlocks;
}

let lastTabBarSig = '';
let lastWindowTitleSig = '';

function renderTabBar(force = false): void {
  saveActiveTabSnapshot();
  scheduleSessionPersist();

  const sig = `${state.activeTabId}|${state.tabs
    .map((t) => `${t.id}:${t.title}:${t.isDirty ? 1 : 0}:${t.filePath || ''}`)
    .join(';')}`;
  if (!force && sig === lastTabBarSig) {
    return;
  }
  lastTabBarSig = sig;

  const tabsHtml = state.tabs
    .map((tab, idx) => {
      const activeClass = tab.id === state.activeTabId ? 'is-active' : '';
      const dirtyHtml = tab.isDirty
        ? '<span class="litemd-tab-dirty" title="Unsaved changes"></span>'
        : '';
      const tooltip = tab.filePath
        ? `${tab.filePath} (Ctrl+${idx + 1})`
        : `${tab.title} — Unsaved buffer (Ctrl+${idx + 1})`;
      return `
        <div class="litemd-tab ${activeClass}" data-tab-id="${tab.id}" title="${tooltip}">
          ${dirtyHtml}
          <span class="litemd-tab-title">${tab.title}</span>
          <button class="litemd-tab-close" data-close-tab-id="${tab.id}" title="Close Tab (Ctrl+W)">✕</button>
        </div>
      `;
    })
    .join('');

  elTabBar.innerHTML = `${tabsHtml}<button class="litemd-tab-add" id="btn-tab-add" title="New Tab (Ctrl+T / Ctrl+N)">+</button>`;
}

function activateTab(tabId: string): void {
  if (tabId === state.activeTabId) return;
  saveActiveTabSnapshot();
  const target = state.tabs.find((t) => t.id === tabId);
  if (!target) return;

  state.activeTabId = target.id;
  state.markdown = target.markdown;
  state.filePath = target.filePath;
  state.lastSavedMtime = target.lastSavedMtime;
  state.isDirty = target.isDirty;
  state.renderedBlocks = target.renderedBlocks;
  state.activeInlineBlockIdx = null;

  elTextarea.value = state.markdown;
  elPreviewSheet.innerHTML = '';

  syncEditorBackdropAndGutter();
  updateLivePreview();
  syncToolbarAndTitle();

  requestAnimationFrame(() => {
    elTextarea.setSelectionRange(target.selectionStart, target.selectionEnd);
    elEditorScroller.scrollTop = target.editorScrollTop;
    elPreviewScroller.scrollTop = target.previewScrollTop;
    updateCursorStatus();
  });
}

function createNewTab(
  initialMarkdown = '# Untitled Note\n\nWrite Markdown and LaTeX math ($x_1 + x_2 = y$) here...\n',
  filePath: string | null = null,
  mtime = 0
): void {
  saveActiveTabSnapshot();
  const seq = state.nextTabSeq++;
  const title = filePath
    ? filePath.split(/[\\/]/).pop() || filePath
    : `Untitled-${seq}.md`;
  const newTab: DocumentTab = {
    id: `tab-${seq}`,
    title,
    filePath,
    lastSavedMtime: mtime,
    isDirty: false,
    markdown: initialMarkdown,
    selectionStart: 0,
    selectionEnd: 0,
    editorScrollTop: 0,
    previewScrollTop: 0,
    renderedBlocks: [],
  };
  state.tabs.push(newTab);
  activateTab(newTab.id);
  elTextarea.focus();
}

function closeTab(tabId: string): void {
  saveActiveTabSnapshot();
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const tab = state.tabs[idx];

  if (tab.isDirty && !confirm(`Discard unsaved changes in "${tab.title}"?`)) {
    return;
  }

  if (state.tabs.length === 1) {
    // Reset the sole remaining tab to a fresh untitled buffer
    const seq = state.nextTabSeq++;
    tab.id = `tab-${seq}`;
    tab.title = `Untitled-${seq}.md`;
    tab.filePath = null;
    tab.lastSavedMtime = 0;
    tab.isDirty = false;
    tab.markdown = '# Untitled Note\n\nWrite Markdown and LaTeX math ($x_1 + x_2 = y$) here...\n';
    tab.selectionStart = 0;
    tab.selectionEnd = 0;
    tab.editorScrollTop = 0;
    tab.previewScrollTop = 0;
    tab.renderedBlocks = [];

    state.activeTabId = tab.id;
    state.markdown = tab.markdown;
    state.filePath = null;
    state.lastSavedMtime = 0;
    state.isDirty = false;
    elTextarea.value = state.markdown;
    elPreviewSheet.innerHTML = '';
    syncEditorBackdropAndGutter();
    updateLivePreview();
    syncToolbarAndTitle();
    return;
  }

  const wasActive = tab.id === state.activeTabId;
  state.tabs.splice(idx, 1);

  if (wasActive) {
    const nextIdx = Math.min(idx, state.tabs.length - 1);
    const nextTab = state.tabs[nextIdx];
    state.activeTabId = ''; // Force activateTab to run
    activateTab(nextTab.id);
  } else {
    renderTabBar();
  }
}

function cycleTab(delta: number): void {
  if (state.tabs.length <= 1) return;
  const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
  const nextIdx = (idx + delta + state.tabs.length) % state.tabs.length;
  activateTab(state.tabs[nextIdx].id);
}

elTabBar.addEventListener('click', (ev) => {
  const target = ev.target as HTMLElement;
  if (target.id === 'btn-tab-add' || target.closest('#btn-tab-add')) {
    createNewTab();
    return;
  }
  const closeBtn = target.closest<HTMLElement>('[data-close-tab-id]');
  if (closeBtn) {
    ev.stopPropagation();
    closeTab(closeBtn.getAttribute('data-close-tab-id')!);
    return;
  }
  const tabEl = target.closest<HTMLElement>('[data-tab-id]');
  if (tabEl) {
    activateTab(tabEl.getAttribute('data-tab-id')!);
  }
});

// Middle-click on any tab closes it immediately
elTabBar.addEventListener('auxclick', (ev) => {
  if (ev.button !== 1) return;
  const tabEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');
  if (tabEl) {
    ev.preventDefault();
    closeTab(tabEl.getAttribute('data-tab-id')!);
  }
});

// Per-line soft-wrap row measurement cache so typing only measures mutated lines
let lineWrapCacheContextKey = '';
const lineWrapRowCache = new Map<string, number>();
const editorMirror = new EditorMirror(elEditorBackdrop, elEditorGutter);

/**
 * Syncs the `<textarea>` height and backdrop/gutter so the outer `#editor-scroller`
 * handles all scrolling with a single classic scrollbar, and measures exact per-line
 * wrapped row heights from `#editor-measurer` with per-line memoization so keystrokes
 * only measure newly edited lines.
 */
function syncEditorBackdropAndGutter(): void {
  const raw = state.markdown;
  const { lines, words } = editorMirror.update(raw);

  const wrapCh = state.theme.editorWrapColumnCh > 0 ? state.theme.editorWrapColumnCh : 92;
  let measuredRowsPerLine: number[] | undefined;

  if (state.theme.editorSoftWrapEnabled) {
    const stageWidth = elEditorStage.clientWidth;
    const singleRowPx = state.theme.editorFontSizePx * state.theme.editorLineHeight;
    const contextKey = `${stageWidth}:${state.theme.editorFontFamily}:${state.theme.editorFontSizePx}:${state.theme.editorLineHeight}:${state.theme.editorWrapColumnCh}`;

    if (contextKey !== lineWrapCacheContextKey) {
      lineWrapCacheContextKey = contextKey;
      lineWrapRowCache.clear();
    }

    if (stageWidth > 0 && singleRowPx > 0) {
      measuredRowsPerLine = new Array<number>(lines.length);
      const missingIndices: number[] = [];

      for (let i = 0; i < lines.length; i++) {
        const cachedRows = lineWrapRowCache.get(lines[i]);
        if (cachedRows !== undefined) {
          measuredRowsPerLine[i] = cachedRows;
        } else {
          missingIndices.push(i);
        }
      }

      if (missingIndices.length > 0) {
        const missingRaw = missingIndices.map((idx) => lines[idx]).join('\n');
        elEditorMeasurer.innerHTML = buildLineMeasurerHtml(missingRaw);
        const children = elEditorMeasurer.children;
        for (let k = 0; k < missingIndices.length; k++) {
          const lineIdx = missingIndices[k];
          const childEl = children[k] as HTMLElement | undefined;
          const h = childEl ? childEl.offsetHeight : singleRowPx;
          const rows = h > 0 ? Math.max(1, Math.round(h / singleRowPx)) : 1;
          measuredRowsPerLine[lineIdx] = rows;
          if (lineWrapRowCache.size > 4096) {
            lineWrapRowCache.clear();
          }
          lineWrapRowCache.set(lines[lineIdx], rows);
        }
      }
    }
  }

  const logicalLines = lines.length;
  const visualWrappedExtraRows = editorMirror.updateGutter(
    state.theme.editorSoftWrapEnabled, wrapCh, measuredRowsPerLine
  );

  // Auto-size textarea to match its scrollHeight so #editor-scroller scrolls smoothly
  elTextarea.style.height = 'auto';
  const targetHeight = Math.max(
    elEditorScroller.clientHeight,
    elTextarea.scrollHeight,
    elEditorBackdrop.scrollHeight
  );
  elTextarea.style.height = `${targetHeight}px`;

  // Update status bar metrics
  const wrapLabel =
    state.theme.editorWrapColumnCh > 0
      ? `${state.theme.editorWrapColumnCh}ch`
      : 'Full Width';
  elStatusStats.textContent = `${logicalLines} lines · ${words} words · ${raw.length} chars`;
  elStatusWrapInfo.textContent = state.theme.editorSoftWrapEnabled
    ? `Soft-Wrap: ${wrapLabel} (+${visualWrappedExtraRows} visual rows, 0 raw \\n added)`
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
  const { line, col } = editorMirror.cursor(pos);
  elStatusCursor.textContent = `Ln ${line}, Col ${col}`;
}

/**
 * Updates toolbar buttons & window title to reflect current state.
 */
function syncToolbarAndTitle(): void {
  const activeTab = getActiveTab();
  const filename = state.filePath
    ? state.filePath.split(/[\\/]/).pop() || state.filePath
    : activeTab?.title || 'Untitled-1.md';
  if (activeTab) {
    activeTab.title = filename;
    activeTab.filePath = state.filePath;
    activeTab.isDirty = state.isDirty;
  }
  elFileLabel.textContent = filename;
  elFileLabel.title = state.filePath || 'Unsaved buffer';
  elDirtyDot.classList.toggle('is-dirty', state.isDirty);
  const titleSig = `${state.filePath || filename}|${state.isDirty ? 1 : 0}`;
  if (titleSig !== lastWindowTitleSig) {
    lastWindowTitleSig = titleSig;
    void updateNativeWindowTitle(state.filePath || filename, state.isDirty);
  }
  renderTabBar();

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
      ta.dir = 'auto';
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
        // Surgically splice only `[blk.startLine .. blk.endLine)` in the original document lines
        // so double blank lines between other blocks and trailing newlines are 100% preserved!
        const newBlockLines = newRaw.replace(/\r\n/g, '\n').split('\n');
        state.markdown = replaceBlockSource(state.markdown, blk.startLine, blk.endLine, newRaw);
        blk.endLine = blk.startLine + newBlockLines.length;
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

let applyingDiskReload = false;
elTextarea.addEventListener('input', () => {
  if (applyingDiskReload) return;
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

  // Indent with 2 spaces on Tab (using undo-safe insertion so Ctrl+Z works)
  if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey) {
    ev.preventDefault();
    const start = elTextarea.selectionStart;
    const end = elTextarea.selectionEnd;
    replaceTextareaRangeUndoable(elTextarea, start, end, '  ', start + 2, start + 2);
    state.markdown = elTextarea.value;
    state.isDirty = true;
    syncEditorBackdropAndGutter();
    updateLivePreview();
    updateCursorStatus();
    syncToolbarAndTitle();
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
    // If file is already open in a tab, switch directly to that tab
    const existing = state.tabs.find(
      (t) => t.filePath && t.filePath.toLowerCase() === path.toLowerCase()
    );
    if (existing) {
      activateTab(existing.id);
      return;
    }

    const content = await readMarkdownFile(path);
    const mtime = await getFileMtime(path);

    // Replace active tab if it is an untouched empty/untitled note; otherwise open in a new tab
    const active = getActiveTab();
    const isUntouchedBlank =
      active &&
      !state.isDirty &&
      !state.filePath &&
      state.markdown.startsWith('# Untitled Note');

    if (isUntouchedBlank) {
      state.markdown = content;
      state.filePath = path;
      state.lastSavedMtime = mtime;
      state.isDirty = false;
      elTextarea.value = content;
      elPreviewSheet.innerHTML = '';
      syncEditorBackdropAndGutter();
      updateLivePreview();
      syncToolbarAndTitle();
    } else {
      createNewTab(content, path, mtime);
    }
  } catch (err) {
    alert(`Could not read file "${path}":\n${String(err)}`);
  }
}

async function handleNewFile(): Promise<void> {
  createNewTab();
}

async function handleOpenFile(): Promise<void> {
  const picked = await pickOpenMarkdownFile();
  if (picked) {
    await loadFileFromPath(picked);
    return;
  }
  // Fallback prompt if running inside browser dev mode
  if (!('__TAURI_INTERNALS__' in window)) {
    const manualPath = prompt('Enter the full path to a Markdown file:', 'notes.md');
    if (manualPath) await loadFileFromPath(manualPath);
  }
}

async function handleSaveFile(forceSaveAs = false): Promise<void> {
  let targetPath = state.filePath;
  if (!targetPath || forceSaveAs) {
    const picked = await pickSaveMarkdownFile(state.filePath || 'notes.md');
    if (!picked) return;
    targetPath = picked;
  } else if (state.lastSavedMtime > 0) {
    // Check if the file on disk was modified externally since we loaded/saved it
    const diskMtime = await getFileMtime(targetPath);
    if (diskMtime !== state.lastSavedMtime) {
      const overwrite = window.confirm(
        `The file "${targetPath}" has been modified on disk by another program since you loaded it.\n\nOverwrite external changes on disk? (Click Cancel to keep disk file and use Save As instead.)`
      );
      if (!overwrite) return;
    }
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

// Lightweight external file modification watcher across all open file-backed tabs
let externalCheckPending = false;
window.setInterval(async () => {
  if (externalCheckPending) return;
  externalCheckPending = true;
  try {
  saveActiveTabSnapshot();
  for (const tab of state.tabs) {
    if (!tab.filePath || tab.lastSavedMtime <= 0) continue;
    const path = tab.filePath;
    const previousContent = tab.markdown;
    const mtime = await getFileMtime(path);
    if (mtime > 0 && mtime !== tab.lastSavedMtime) {
      if (!tab.isDirty) {
        const content = await readMarkdownFile(path);
        // Reading is asynchronous: never replace edits typed while the disk read was pending.
        if (!state.tabs.includes(tab) || tab.filePath !== path || tab.isDirty || tab.markdown !== previousContent) continue;
        tab.lastSavedMtime = mtime;
        if (tab.id === state.activeTabId) state.lastSavedMtime = mtime;
        if (content !== tab.markdown) {
          tab.markdown = content;
          if (tab.id === state.activeTabId) {
            state.markdown = content;
            state.lastSavedMtime = mtime;
            applyingDiskReload = true;
            try {
              replaceTextareaRangeUndoable(elTextarea, 0, elTextarea.value.length, content,
                Math.min(elTextarea.selectionStart, content.length),
                Math.min(elTextarea.selectionEnd, content.length));
            } finally {
              applyingDiskReload = false;
            }
            syncEditorBackdropAndGutter();
            updateLivePreview();
          }
          elStatusPerf.textContent = `Auto-reloaded external edit (${tab.title})`;
        }
      } else if (tab.id === state.activeTabId) {
        elStatusPerf.textContent = `⚠️ External disk change detected on ${tab.title}`;
      }
    }
  }
  } catch {
    // A deleted/locked document must not stop checks for future external changes.
  } finally {
    externalCheckPending = false;
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

// Interactive GFM task-list checkbox toggling in the Preview Pane (undo-safe!)
elPreviewSheet.addEventListener('change', (ev) => {
  const target = ev.target as HTMLInputElement;
  if (!target || !target.classList.contains('litemd-task-checkbox')) return;
  const li = target.closest('li[data-line]');
  if (!li) return;
  const lineIdx = Number(li.getAttribute('data-line'));
  const lines = state.markdown.split('\n');
  if (lineIdx >= 0 && lineIdx < lines.length) {
    let charStart = 0;
    for (let i = 0; i < lineIdx; i++) {
      charStart += lines[i].length + 1;
    }
    const oldLine = lines[lineIdx];
    const newLine = oldLine.replace(
      /^(\s*[-*+]\s+\[)[ xX](\])/,
      `$1${target.checked ? 'x' : ' '}$2`
    );
    if (newLine !== oldLine) {
      replaceTextareaRangeUndoable(
        elTextarea,
        charStart,
        charStart + oldLine.length,
        newLine,
        elTextarea.selectionStart,
        elTextarea.selectionEnd
      );
      state.markdown = elTextarea.value;
      state.isDirty = true;
      syncEditorBackdropAndGutter();
      updateLivePreview();
      syncToolbarAndTitle();
    }
  }
});

// Intercept link clicks in Preview & Inline Canvas so clicking a link never navigates the app window
function handlePreviewLinkClick(ev: MouseEvent): boolean {
  const anchor = (ev.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!anchor) return false;
  ev.preventDefault();
  ev.stopPropagation();
  const href = (anchor.getAttribute('href') || '').trim();
  if (!href) return true;

  if (href.startsWith('#')) {
    const targetId = href.slice(1);
    const dest = document.getElementById(targetId);
    if (dest) {
      dest.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return true;
  }

  const lower = href.toLowerCase();
  if (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('mailto:')
  ) {
    void openExternalUrl(href);
  }
  return true;
}

elInlineCanvas.addEventListener('click', (ev) => {
  handlePreviewLinkClick(ev);
});

elPreviewSheet.addEventListener('click', (ev) => {
  if (handlePreviewLinkClick(ev)) return;
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
  for (const rec of entries) {
    try {
      const parsed = JSON.parse(rec.json) as Partial<LiteMDThemeConfig>;
      if (parsed && typeof parsed === 'object') {
        const merged = {
          ...cloneTheme(THEME_PRESETS['latex-academic']),
          ...parsed,
          id: `custom:${rec.name}`,
          name: parsed.name || rec.name,
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
        <button class="litemd-btn" id="btn-save-theme-d" title="Save custom theme JSON">Save Theme JSON</button>
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
        <input type="range" min="640" max="2400" step="20" data-theme-num="previewMaxWidthPx" value="${t.previewMaxWidthPx || 2400}" />
        <span class="litemd-val-badge" data-badge="previewMaxWidthPx">${
          t.previewMaxWidthPx > 0 ? `${t.previewMaxWidthPx}px` : '100%'
        }</span>
        <button class="litemd-btn ${t.previewMaxWidthPx === 0 ? 'is-active' : ''}" id="btn-full-width-page" title="Expand page column to 100% full pane width">100%</button>
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
        <input type="range" min="0" max="180" step="2" data-theme-num="editorWrapColumnCh" value="${t.editorWrapColumnCh}" />
        <span class="litemd-val-badge" data-badge="editorWrapColumnCh">${
          t.editorWrapColumnCh > 0 ? `${t.editorWrapColumnCh}ch` : '100%'
        }</span>
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

  // Full-width page toggle button in Studio Drawer
  document.getElementById('btn-full-width-page')?.addEventListener('click', () => {
    state.theme.previewMaxWidthPx = state.theme.previewMaxWidthPx === 0 ? 1560 : 0;
    applyThemeToDOM(state.theme);
    renderStudioDrawerControls();
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
        if (key === 'editorWrapColumnCh' && numVal <= 0) {
          badge.textContent = '100%';
        } else if (key === 'previewMaxWidthPx' && numVal <= 0) {
          badge.textContent = '100%';
        } else {
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

  if ((key === 'n' || key === 't') && !ev.shiftKey) {
    ev.preventDefault();
    createNewTab();
  } else if (key === 'w' && !ev.shiftKey) {
    ev.preventDefault();
    closeTab(state.activeTabId);
  } else if (ev.key === 'Tab') {
    ev.preventDefault();
    cycleTab(ev.shiftKey ? -1 : 1);
  } else if (ev.key === 'PageDown') {
    ev.preventDefault();
    cycleTab(1);
  } else if (ev.key === 'PageUp') {
    ev.preventDefault();
    cycleTab(-1);
  } else if (key >= '1' && key <= '9' && !ev.shiftKey) {
    const idx = Number(key) - 1;
    if (idx < state.tabs.length) {
      ev.preventDefault();
      activateTab(state.tabs[idx].id);
    }
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

// Guarantee zero-loss session flush & unsaved-changes close guard on window close
registerWindowCloseGuard(
  () => state.tabs.some((t) => t.isDirty),
  () => flushSessionNow(false)
);
window.addEventListener('beforeunload', () => {
  flushSessionNow(true);
});
window.addEventListener('pagehide', () => {
  flushSessionNow(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushSessionNow(false);
  }
});

// Attempt immediate 0ms synchronous restore from localStorage cache on D:\
let restoredSync = false;
try {
  const cachedSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (cachedSession) {
    restoredSync = applyPersistedSessionJson(cachedSession);
  }
} catch {
  // Ignore if localStorage is unavailable
}

// Frame-1 Initialization
if (!restoredSync) {
  syncToolbarAndTitle();
  syncEditorBackdropAndGutter();
  updateLivePreview();
  updateCursorStatus();
}

// Check for D:\ session.json fallback and CLI file argument (`litemd notes.md`) immediately after initial paint
requestAnimationFrame(() => requestAnimationFrame(async () => {
  // Also restores backend file capabilities when the buffers came from localStorage.
  const diskSession = await loadSessionStateFromD();
  if (!restoredSync && diskSession) {
    applyPersistedSessionJson(diskSession);
  }
  const cliFile = await getCliFileArg();
  if (cliFile) {
    await loadFileFromPath(cliFile);
  }
  await refreshCustomThemesFromD();
}));
