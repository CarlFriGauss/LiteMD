// Optional presentation subset. Native HTML/CSS parsers are allocated only on first use.
export const IMAGE_FEATURE = 1;
export const HTML_FEATURE = 2;
export const STYLE_FEATURE = 4;
export interface PresentationResult { html: string; features: number; images?: string[] }
type AttributeText = (value: string) => string;
let tags: Set<string> | undefined;
let properties: Set<string> | undefined;
let template: HTMLTemplateElement | undefined;
let declaration: CSSStyleDeclaration | undefined;
let sheet: CSSStyleSheet | undefined;
const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function attributeText(value: string, restore: AttributeText = value => value): string {
  // Math placeholders must never expand generated HTML inside an attribute.
  return escaped(restore(value)).replace(/LITEMDMATH/g, 'LITEMD&#77;ATH').replace(/LITEMDCODE/g, 'LITEMD&#67;ODE').replace(/\[/g, '&#91;');
}
function policy(): Set<string> {
  return tags ??= new Set('small strong em b i u s sub sup span p div section figure figcaption img h1 h2 h3 h4 h5 h6 br hr blockquote ul ol li table thead tbody tfoot tr th td'.split(' '));
}
function validClass(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(value) && !/^(?:litemd|katex|hl-|is-)/i.test(value);
}
export function imageSource(value: string): 'remote' | 'local' | 'blocked' {
  const source = value.trim();
  if (/^https?:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      return ['asset.localhost', 'ipc.localhost', 'litemd-image.localhost'].includes(url.hostname.toLowerCase()) ? 'blocked' : 'remote';
    } catch { return 'blocked'; }
  }
  if (!source || source.startsWith('/') || source.startsWith('\\') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(source)) return 'blocked';
  return 'local';
}
export function imageMarkup(source: string, alt: string, title = '', restore?: AttributeText): string {
  const kind = imageSource(source);
  const attributes = kind === 'remote' ? ' src="' + attributeText(source, restore) + '"'
    : kind === 'local' ? ' data-litemd-image="' + attributeText(source, restore) + '"' : '';
  return '<img' + attributes + ' alt="' + attributeText(alt, restore) + '"' +
    (title ? ' title="' + attributeText(title, restore) + '"' : '') + ' loading="lazy" decoding="async">';
}
function cleanDeclarations(source: string): string {
  if (source.length > 4096) return '';
  properties ??= new Set(('color background background-color font-family font-size font-weight font-style line-height letter-spacing word-spacing text-align text-decoration text-transform white-space ' +
    'margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left ' +
    'border border-top border-right border-bottom border-left border-color border-style border-width border-radius ' +
    'border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style ' +
    'border-top-color border-right-color border-bottom-color border-left-color border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius ' +
    'width min-width max-width height min-height max-height display flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-content align-self justify-content gap row-gap column-gap').split(' '));
  declaration ??= document.createElement('span').style;
  declaration.cssText = source;
  const output: string[] = [];
  for (let i = 0; i < declaration.length && output.length < 48; i++) {
    let name = declaration.item(i);
    if (!properties.has(name)) continue;
    let value = declaration.getPropertyValue(name).trim();
    if (name === 'background') {
      if (declaration.backgroundImage && declaration.backgroundImage !== 'none') continue;
      name = 'background-color'; value = declaration.backgroundColor;
    }
    if (!value || value.length > 256 || /[\\{};<>@]/.test(value) || value.includes('/*') || /LITEMD(?:MATH|CODE)/.test(value)) continue;
    // CSSOM supplies syntax/type validation. This deliberately excludes dynamic/resource functions.
    const functions = [...value.matchAll(/([A-Za-z_-][A-Za-z0-9_-]*)\s*\(/g)];
    if (functions.some(m => !/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|calc|clamp|min|max)$/i.test(m[1]))) continue;
    if (name === 'display' && !/^(?:block|inline|inline-block|flex|inline-flex|none)$/.test(value)) continue;
    if (!/^(?:color|background-color|border-color|font-family)$/.test(name) &&
        [...value.replace(/#[0-9a-f]{3,8}\b/gi, '').matchAll(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].some(m => Math.abs(Number(m[0])) > 4096)) continue;
    output.push(name + ':' + value + ';');
  }
  declaration.cssText = '';
  return output.join('');
}
function selectors(source: string): string[] {
  // Only simple type/class, descendant/child selectors and comma groups. No escapes,
  // attributes, pseudo selectors, namespaces, nesting, or selector-list functions.
  if (source.length > 256 || !/^[A-Za-z0-9_.*,\s>-]+$/.test(source)) return [];
  const groups = source.split(',').map(s => s.trim());
  for (const group of groups) {
    if (!group) return [];
    for (const compound of group.split(/[\s>]+/)) {
      if (!compound) continue;
      const [tag, ...classes] = compound.split('.');
      if (tag && tag !== '*' && !policy().has(tag.toLowerCase())) return [];
      if (!tag && classes.length === 0 || classes.some(c => !validClass(c))) return [];
    }
  }
  return groups;
}
export function safeStyles(source: string, scope?: string): string {
  if (!source || source.length > 32768 || typeof CSSStyleSheet === 'undefined') return '';
  sheet ??= new CSSStyleSheet();
  try { sheet.replaceSync(source); } catch { return ''; }
  const rules: string[] = [];
  for (const rule of Array.from(sheet.cssRules).slice(0, 128)) {
    if (rule.type !== 1) continue; // No imports, font faces, keyframes, nesting, or other at-rules.
    const styleRule = rule as CSSStyleRule;
    const names = selectors(styleRule.selectorText), declarations = cleanDeclarations(styleRule.style.cssText);
    if (!names.length || !declarations) continue;
    const prefix = scope ? '[data-litemd-document="' + scope + '"] ' : '';
    const suffix = scope ? '[data-litemd-presentation]' : '';
    rules.push(names.map(name => prefix + name + suffix).join(',') + '{' + declarations + '}');
  }
  sheet.replaceSync('');
  return rules.join('\n');
}
function attributes(element: Element, restore?: AttributeText): string {
  const parts: string[] = [' data-litemd-presentation=""'];
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase(), value = attribute.value;
    if (name === 'class') {
      const classes = value.split(/\s+/).filter(validClass).slice(0, 16).join(' ');
      if (classes) parts.push(' class="' + classes + '"');
    } else if (name === 'style') {
      const style = cleanDeclarations(value);
      if (style) parts.push(' style="' + attributeText(style) + '"');
    } else if (name === 'title' || name === 'lang' || name === 'dir' && /^(?:auto|ltr|rtl)$/.test(value)) {
      parts.push(' ' + name + '="' + attributeText(value.slice(0, 1024), restore) + '"');
    } else if (['width','height','colspan','rowspan'].includes(name) && /^\d{1,4}$/.test(value) && Number(value) <= 4096) {
      parts.push(' ' + name + '="' + value + '"');
    }
  }
  return parts.join('');
}
export function sanitizePresentation(source: string, inline = false, restore?: AttributeText): PresentationResult {
  if (source.length > 65536 || typeof document === 'undefined') return { html: escaped(source), features: 0 };
  const allowed = policy();
  if (inline && source.startsWith('</')) {
    const name = source.slice(2, -1).trim().toLowerCase();
    return { html: allowed.has(name) && !['img','br','hr'].includes(name) ? '</' + name + '>' : '', features: HTML_FEATURE };
  }
  template ??= document.createElement('template');
  template.innerHTML = source; // Template contents are inert, including images and scripts.
  let features = HTML_FEATURE, remaining = 512;
  let images: string[] | undefined;
  function visit(node: Node, depth = 0): string {
    if (--remaining < 0 || depth > 32) return '';
    if (node.nodeType === 3) return escaped(node.textContent || '');
    if (node.nodeType !== 1) return '';
    const element = node as Element, name = element.localName;
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return '';
    if (name === 'style') {
      const css = safeStyles(element.textContent || '');
      if (!css) return '';
      features |= STYLE_FEATURE;
      return '<template data-litemd-author-style>' + escaped(css) + '</template>';
    }
    if (['script','iframe','object','embed','link','meta','base','head','form','input','button','textarea','select','template'].includes(name)) return '';
    if (!allowed.has(name)) return Array.from(element.childNodes).map(n => visit(n, depth + 1)).join('');
    if (name === 'img') {
      features |= IMAGE_FEATURE;
      const source = restore ? restore(element.getAttribute('src') || '') : element.getAttribute('src') || '';
      if (imageSource(source) === 'local') (images ??= []).push(source);
      const markup = imageMarkup(source, element.getAttribute('alt') || '', element.getAttribute('title') || '', restore);
      return markup.replace('<img', '<img' + attributes(element, restore));
    }
    const opening = '<' + name + attributes(element, restore) + '>';
    if (['br','hr'].includes(name)) return opening;
    if (inline) return opening;
    return opening + Array.from(element.childNodes).map(n => visit(n, depth + 1)).join('') + '</' + name + '>';
  }
  try {
    const html = Array.from(template.content.childNodes).map(node => visit(node)).join('');
    return { html, features, images };
  } finally { template.innerHTML = ''; }
}
export function hasPresentation(source: string): boolean {
  if (source.indexOf('<') < 0) return false;
  return /<\/?(?:small|strong|em|span|p|div|section|figure|figcaption|img|h[1-6]|style|br|hr|b|i|u|s|sub|sup|blockquote|ul|ol|li|table|thead|tbody|tfoot|tr|th|td)(?:\s|\/?>)/i.test(source);
}
