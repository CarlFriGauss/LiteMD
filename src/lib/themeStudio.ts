/**
 * LiteMD — Theme, Typography & Layout Studio Engine (spec.md Section 7)
 *
 * Updates CSS Custom Properties (`--var`) directly on `:root` for 60fps zero-reparse
 * live scrubbing, manages the 4 built-in presets (*LaTeX Academic Paper*,
 * *Warm Sepia Textbook*, *Dark OLED Math*, *High-Contrast Blueprint*),
 * and persists custom user themes as lightweight JSON files on the `D:\` drive.
 */

export interface LiteMDThemeConfig {
  id: string;
  name: string;
  isDark: boolean;

  // A. Rendered Preview Typography
  previewFontBody: string;
  previewFontHeading: string;
  previewFontCode: string;
  previewFontMath: string;
  previewFontSizePx: number;
  previewLineHeight: number;
  previewLetterSpacingEm: number;
  previewParaSpacingEm: number;
  previewMathScale: number;

  // A.2 Page Geometry & Margins
  previewMarginYPx: number;
  previewMarginXPx: number;
  previewMaxWidthPx: number; // 0 = 100% full width
  previewSectionSpacingEm: number;

  // A.3 Granular Color Palette
  previewWorkspaceBg: string;
  previewCanvasBg: string;
  previewBodyColor: string;
  previewMutedColor: string;
  unifyHeadingColors: boolean;
  previewHeadingUnifiedColor: string;
  previewH1Color: string;
  previewH2Color: string;
  previewH3Color: string;
  previewH4Color: string;
  previewHeadingBorderColor: string;
  previewMathColor: string;
  previewMathBg: string;
  previewMathBorder: string;
  previewQuoteBorder: string;
  previewQuoteBg: string;
  previewInlineCodeBg: string;
  previewInlineCodeColor: string;
  previewLinkColor: string;
  previewTableBorder: string;
  previewTableStripe: string;

  // B. Raw Editor Customization & Visual Soft-Wrapping (Section 6 & 7.B)
  editorBg: string;
  editorFg: string;
  editorGutterBg: string;
  editorGutterFg: string;
  editorSelectionBg: string;
  editorFontFamily: string;
  editorFontSizePx: number;
  editorLineHeight: number;
  editorSoftWrapEnabled: boolean;
  editorWrapColumnCh: number; // e.g., 65 to 120, or 0 for 100% pane width
  syntaxHeadingColor: string;
  syntaxEmphasisColor: string;
  syntaxMathFgColor: string;
  syntaxMathBgColor: string;
  syntaxCodeColor: string;
}

export const FONT_OPTIONS = {
  body: [
    { label: 'KaTeX / Computer Modern (Academic Serif)', value: '"KaTeX_Main", "Cambria", "Georgia", serif' },
    { label: 'Georgia / Classic Book Serif', value: '"Georgia", "Cambria", "Times New Roman", serif' },
    { label: 'Palatino / Warm Textbook Serif', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
    { label: 'Segoe UI / Crisp Modern Sans', value: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif' },
  ],
  heading: [
    { label: 'Segoe UI / Modern Sans-Serif', value: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif' },
    { label: 'KaTeX / Computer Modern Serif', value: '"KaTeX_Main", "Cambria", "Georgia", serif' },
    { label: 'Georgia / Display Serif', value: '"Georgia", "Cambria", serif' },
    { label: 'Palatino / Textbook Display', value: '"Palatino Linotype", "Book Antiqua", serif' },
  ],
  code: [
    { label: 'Cascadia Mono / Consolas', value: '"Cascadia Mono", "Consolas", "Courier New", monospace' },
    { label: 'Consolas (Windows Classic)', value: '"Consolas", "Courier New", monospace' },
    { label: 'KaTeX Typewriter', value: '"KaTeX_Typewriter", "Consolas", monospace' },
  ],
  math: [
    { label: 'KaTeX Main (Computer Modern)', value: '"KaTeX_Main", "Times New Roman", serif' },
    { label: 'Cambria Math / Academic', value: '"Cambria Math", "KaTeX_Main", serif' },
  ],
};

export const THEME_PRESETS: Record<string, LiteMDThemeConfig> = {
  'latex-academic': {
    id: 'latex-academic',
    name: 'LaTeX Academic Paper',
    isDark: false,
    previewFontBody: '"KaTeX_Main", "Cambria", "Georgia", serif',
    previewFontHeading: '"KaTeX_Main", "Cambria", "Georgia", serif',
    previewFontCode: '"Cascadia Mono", "Consolas", "Courier New", monospace',
    previewFontMath: '"KaTeX_Main", "Times New Roman", serif',
    previewFontSizePx: 17,
    previewLineHeight: 1.72,
    previewLetterSpacingEm: 0,
    previewParaSpacingEm: 1.05,
    previewMathScale: 1.0,
    previewMarginYPx: 44,
    previewMarginXPx: 52,
    previewMaxWidthPx: 840,
    previewSectionSpacingEm: 1.55,
    previewWorkspaceBg: '#e9ecef',
    previewCanvasBg: '#ffffff',
    previewBodyColor: '#181a1f',
    previewMutedColor: '#5c6370',
    unifyHeadingColors: false,
    previewHeadingUnifiedColor: '#0f172a',
    previewH1Color: '#0f172a',
    previewH2Color: '#1e3a8a',
    previewH3Color: '#1e40af',
    previewH4Color: '#334155',
    previewHeadingBorderColor: '#cbd5e1',
    previewMathColor: '#0f172a',
    previewMathBg: '#f8fafc',
    previewMathBorder: '#e2e8f0',
    previewQuoteBorder: '#2563eb',
    previewQuoteBg: '#f1f5f9',
    previewInlineCodeBg: '#f1f5f9',
    previewInlineCodeColor: '#be123c',
    previewLinkColor: '#1d4ed8',
    previewTableBorder: '#cbd5e1',
    previewTableStripe: '#f8fafc',
    editorBg: '#fcfcfd',
    editorFg: '#1e293b',
    editorGutterBg: '#f1f5f9',
    editorGutterFg: '#64748b',
    editorSelectionBg: '#bfdbfe',
    editorFontFamily: '"Cascadia Mono", "Consolas", "Courier New", monospace',
    editorFontSizePx: 14.5,
    editorLineHeight: 1.65,
    editorSoftWrapEnabled: true,
    editorWrapColumnCh: 86,
    syntaxHeadingColor: '#1d4ed8',
    syntaxEmphasisColor: '#7c3aed',
    syntaxMathFgColor: '#047857',
    syntaxMathBgColor: 'rgba(16, 185, 129, 0.10)',
    syntaxCodeColor: '#be123c',
  },

  'warm-sepia': {
    id: 'warm-sepia',
    name: 'Warm Sepia Textbook',
    isDark: false,
    previewFontBody: '"Palatino Linotype", "Book Antiqua", Palatino, serif',
    previewFontHeading: '"Georgia", "Cambria", serif',
    previewFontCode: '"Consolas", "Courier New", monospace',
    previewFontMath: '"KaTeX_Main", "Times New Roman", serif',
    previewFontSizePx: 17,
    previewLineHeight: 1.76,
    previewLetterSpacingEm: 0.005,
    previewParaSpacingEm: 1.1,
    previewMathScale: 1.0,
    previewMarginYPx: 46,
    previewMarginXPx: 54,
    previewMaxWidthPx: 820,
    previewSectionSpacingEm: 1.6,
    previewWorkspaceBg: '#e6dcc8',
    previewCanvasBg: '#fbf6ec',
    previewBodyColor: '#2c221e',
    previewMutedColor: '#6e5a4f',
    unifyHeadingColors: false,
    previewHeadingUnifiedColor: '#5c2018',
    previewH1Color: '#5c2018',
    previewH2Color: '#7c2d12',
    previewH3Color: '#9a3412',
    previewH4Color: '#57534e',
    previewHeadingBorderColor: '#decbb1',
    previewMathColor: '#291c14',
    previewMathBg: '#f4ead5',
    previewMathBorder: '#dfd0b8',
    previewQuoteBorder: '#b45309',
    previewQuoteBg: '#f3e8d2',
    previewInlineCodeBg: '#efe2c8',
    previewInlineCodeColor: '#9a3412',
    previewLinkColor: '#9a3412',
    previewTableBorder: '#d6c3a5',
    previewTableStripe: '#f5ebd6',
    editorBg: '#f8f1e3',
    editorFg: '#2c221e',
    editorGutterBg: '#efe4ce',
    editorGutterFg: '#85715e',
    editorSelectionBg: '#e7d1a7',
    editorFontFamily: '"Cascadia Mono", "Consolas", monospace',
    editorFontSizePx: 14.5,
    editorLineHeight: 1.65,
    editorSoftWrapEnabled: true,
    editorWrapColumnCh: 84,
    syntaxHeadingColor: '#9a3412',
    syntaxEmphasisColor: '#6d28d9',
    syntaxMathFgColor: '#115e59',
    syntaxMathBgColor: 'rgba(17, 94, 89, 0.11)',
    syntaxCodeColor: '#9f1239',
  },

  'dark-oled': {
    id: 'dark-oled',
    name: 'Dark OLED Math',
    isDark: true,
    previewFontBody: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
    previewFontHeading: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
    previewFontCode: '"Cascadia Mono", "Consolas", monospace',
    previewFontMath: '"KaTeX_Main", "Times New Roman", serif',
    previewFontSizePx: 16.5,
    previewLineHeight: 1.72,
    previewLetterSpacingEm: 0.005,
    previewParaSpacingEm: 1.05,
    previewMathScale: 1.0,
    previewMarginYPx: 44,
    previewMarginXPx: 52,
    previewMaxWidthPx: 860,
    previewSectionSpacingEm: 1.55,
    previewWorkspaceBg: '#06080c',
    previewCanvasBg: '#0d1117',
    previewBodyColor: '#e2e8f0',
    previewMutedColor: '#94a3b8',
    unifyHeadingColors: false,
    previewHeadingUnifiedColor: '#38bdf8',
    previewH1Color: '#f8fafc',
    previewH2Color: '#38bdf8',
    previewH3Color: '#34d399',
    previewH4Color: '#a78bfa',
    previewHeadingBorderColor: '#1e293b',
    previewMathColor: '#67e8f9',
    previewMathBg: '#111827',
    previewMathBorder: '#1e293b',
    previewQuoteBorder: '#38bdf8',
    previewQuoteBg: '#111827',
    previewInlineCodeBg: '#1e293b',
    previewInlineCodeColor: '#f472b6',
    previewLinkColor: '#38bdf8',
    previewTableBorder: '#1e293b',
    previewTableStripe: '#111827',
    editorBg: '#090d14',
    editorFg: '#e2e8f0',
    editorGutterBg: '#06080c',
    editorGutterFg: '#475569',
    editorSelectionBg: '#1e3a8a',
    editorFontFamily: '"Cascadia Mono", "Consolas", monospace',
    editorFontSizePx: 14.5,
    editorLineHeight: 1.65,
    editorSoftWrapEnabled: true,
    editorWrapColumnCh: 88,
    syntaxHeadingColor: '#38bdf8',
    syntaxEmphasisColor: '#c084fc',
    syntaxMathFgColor: '#34d399',
    syntaxMathBgColor: 'rgba(52, 211, 153, 0.14)',
    syntaxCodeColor: '#f472b6',
  },

  'high-contrast-blueprint': {
    id: 'high-contrast-blueprint',
    name: 'High-Contrast Blueprint',
    isDark: true,
    previewFontBody: '"Segoe UI", -apple-system, sans-serif',
    previewFontHeading: '"Cascadia Mono", "Consolas", monospace',
    previewFontCode: '"Cascadia Mono", "Consolas", monospace',
    previewFontMath: '"KaTeX_Main", "Times New Roman", serif',
    previewFontSizePx: 16.5,
    previewLineHeight: 1.7,
    previewLetterSpacingEm: 0.01,
    previewParaSpacingEm: 1.05,
    previewMathScale: 1.0,
    previewMarginYPx: 42,
    previewMarginXPx: 48,
    previewMaxWidthPx: 880,
    previewSectionSpacingEm: 1.5,
    previewWorkspaceBg: '#071326',
    previewCanvasBg: '#0b1d3a',
    previewBodyColor: '#f0f9ff',
    previewMutedColor: '#93c5fd',
    unifyHeadingColors: false,
    previewHeadingUnifiedColor: '#facc15',
    previewH1Color: '#facc15',
    previewH2Color: '#38bdf8',
    previewH3Color: '#4ade80',
    previewH4Color: '#f8fafc',
    previewHeadingBorderColor: '#1d4ed8',
    previewMathColor: '#fef08a',
    previewMathBg: '#0f2952',
    previewMathBorder: '#2563eb',
    previewQuoteBorder: '#facc15',
    previewQuoteBg: '#0f2952',
    previewInlineCodeBg: '#17376e',
    previewInlineCodeColor: '#fde047',
    previewLinkColor: '#38bdf8',
    previewTableBorder: '#2563eb',
    previewTableStripe: '#0f2952',
    editorBg: '#08172e',
    editorFg: '#f0f9ff',
    editorGutterBg: '#061124',
    editorGutterFg: '#60a5fa',
    editorSelectionBg: '#1d4ed8',
    editorFontFamily: '"Cascadia Mono", "Consolas", monospace',
    editorFontSizePx: 14.5,
    editorLineHeight: 1.65,
    editorSoftWrapEnabled: true,
    editorWrapColumnCh: 88,
    syntaxHeadingColor: '#facc15',
    syntaxEmphasisColor: '#7dd3fc',
    syntaxMathFgColor: '#4ade80',
    syntaxMathBgColor: 'rgba(74, 222, 128, 0.16)',
    syntaxCodeColor: '#fde047',
  },
};

/**
 * Applies a theme configuration to `:root` CSS Custom Properties in <0.2ms without re-parsing Markdown.
 */
export function applyThemeToDOM(theme: LiteMDThemeConfig): void {
  const root = document.documentElement;
  const s = root.style;

  root.setAttribute('data-theme', theme.isDark ? 'dark' : 'light');

  // Preview Typography
  s.setProperty('--preview-font-body', theme.previewFontBody);
  s.setProperty('--preview-font-heading', theme.previewFontHeading);
  s.setProperty('--preview-font-code', theme.previewFontCode);
  s.setProperty('--preview-font-math', theme.previewFontMath);
  s.setProperty('--preview-font-size', `${theme.previewFontSizePx}px`);
  s.setProperty('--preview-line-height', String(theme.previewLineHeight));
  s.setProperty('--preview-letter-spacing', `${theme.previewLetterSpacingEm}em`);
  s.setProperty('--preview-para-spacing', `${theme.previewParaSpacingEm}em`);
  s.setProperty('--math-scale', String(theme.previewMathScale ?? 1.0));

  // Page Geometry & Margins
  s.setProperty('--preview-margin-y', `${theme.previewMarginYPx}px`);
  s.setProperty('--preview-margin-x', `${theme.previewMarginXPx}px`);
  s.setProperty(
    '--preview-max-width',
    theme.previewMaxWidthPx > 0 ? `${theme.previewMaxWidthPx}px` : '100%'
  );
  s.setProperty('--preview-section-spacing', `${theme.previewSectionSpacingEm}em`);

  // Preview Colors
  s.setProperty('--preview-workspace-bg', theme.previewWorkspaceBg);
  s.setProperty('--preview-canvas-bg', theme.previewCanvasBg);
  s.setProperty('--preview-body-color', theme.previewBodyColor);
  s.setProperty('--preview-muted-color', theme.previewMutedColor);

  const h1 = theme.unifyHeadingColors ? theme.previewHeadingUnifiedColor : theme.previewH1Color;
  const h2 = theme.unifyHeadingColors ? theme.previewHeadingUnifiedColor : theme.previewH2Color;
  const h3 = theme.unifyHeadingColors ? theme.previewHeadingUnifiedColor : theme.previewH3Color;
  const h4 = theme.unifyHeadingColors ? theme.previewHeadingUnifiedColor : theme.previewH4Color;

  s.setProperty('--preview-h1-color', h1);
  s.setProperty('--preview-h2-color', h2);
  s.setProperty('--preview-h3-color', h3);
  s.setProperty('--preview-h4-color', h4);
  s.setProperty('--preview-h-border-color', theme.previewHeadingBorderColor);

  s.setProperty('--preview-math-color', theme.previewMathColor);
  s.setProperty('--preview-math-bg', theme.previewMathBg);
  s.setProperty('--preview-math-border', theme.previewMathBorder);
  s.setProperty('--preview-quote-border', theme.previewQuoteBorder);
  s.setProperty('--preview-quote-bg', theme.previewQuoteBg);
  s.setProperty('--preview-inline-code-bg', theme.previewInlineCodeBg);
  s.setProperty('--preview-inline-code-color', theme.previewInlineCodeColor);
  s.setProperty('--preview-link-color', theme.previewLinkColor);
  s.setProperty('--preview-table-border', theme.previewTableBorder);
  s.setProperty('--preview-table-stripe', theme.previewTableStripe);

  // Raw Editor & Soft-Wrap Configuration
  s.setProperty('--editor-bg', theme.editorBg);
  s.setProperty('--editor-fg', theme.editorFg);
  s.setProperty('--editor-gutter-bg', theme.editorGutterBg);
  s.setProperty('--editor-gutter-fg', theme.editorGutterFg);
  s.setProperty('--editor-selection-bg', theme.editorSelectionBg);
  s.setProperty('--editor-font-family', theme.editorFontFamily);
  s.setProperty('--editor-font-size', `${theme.editorFontSizePx}px`);
  s.setProperty('--editor-line-height', String(theme.editorLineHeight));
  s.setProperty(
    '--editor-wrap-width',
    theme.editorSoftWrapEnabled && theme.editorWrapColumnCh > 0
      ? `${theme.editorWrapColumnCh}ch`
      : '100%'
  );

  s.setProperty('--syntax-heading', theme.syntaxHeadingColor);
  s.setProperty('--syntax-emphasis', theme.syntaxEmphasisColor);
  s.setProperty('--syntax-math-fg', theme.syntaxMathFgColor);
  s.setProperty('--syntax-math-bg', theme.syntaxMathBgColor);
  s.setProperty('--syntax-code', theme.syntaxCodeColor);
}

export function cloneTheme(theme: LiteMDThemeConfig): LiteMDThemeConfig {
  return JSON.parse(JSON.stringify(theme));
}
