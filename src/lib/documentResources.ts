import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { IMAGE_FEATURE, STYLE_FEATURE, safeStyles } from './presentation';

export interface RenderDocument { filePath: string | null; resources?: DocumentResources }
export interface BlockPresentation { features: number; images?: string[] }
interface ImageEntry { count: number; nodes: Set<HTMLImageElement>; url?: string; error?: string; refreshing?: boolean }
interface Binding { resources: DocumentResources; references: string[]; nodes: HTMLImageElement[]; metadata: BlockPresentation }
interface Resolution { reference: string; key: string | null; version: string; error: string | null }
const BINDING = Symbol('document presentation');
const DOCUMENT = Symbol('render document');
const IMAGE_TITLE = Symbol('author image title');
type ImageElement = HTMLImageElement & { [IMAGE_TITLE]?: string };
type BlockElement = HTMLElement & { [BINDING]?: Binding };
type RootElement = HTMLElement & { [DOCUMENT]?: RenderDocument };
let nextDocument = 0;

function referencePath(source: string): string | null {
  try {
    const end = source.search(/[?#]/);
    let path = decodeURIComponent(end < 0 ? source : source.slice(0, end)).replaceAll('\\', '/');
    while (path.startsWith('./')) path = path.slice(2);
    return path;
  } catch { return null; }
}
export class DocumentResources {
  readonly scope = 'doc-' + (++nextDocument).toString(36);
  private images?: Map<string, ImageEntry>;
  private zero?: Set<string>;
  private queued = false;
  private dirty = false;
  private disposed = false;
  private suspended = false;
  private epoch = 0;
  private pathRevision = 0;
  private work?: Promise<void>;
  constructor(private path: string | null) {}
  get domKey(): string { return this.scope + ':' + this.pathRevision; }
  suspend(): void {
    this.suspended = true;
    this.images?.forEach(entry => entry.nodes.clear());
  }
  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.images?.size) {
      this.images.forEach(entry => { entry.refreshing = !!this.path; });
      this.dirty = true; this.schedule();
    }
  }

  setPath(path: string | null): void {
    if (this.path === path) return;
    this.path = path; this.epoch++; this.pathRevision++; this.dirty = true;
    this.images?.forEach(entry => { entry.url = undefined; entry.error = undefined; entry.nodes.forEach(node => node.removeAttribute('src')); });
    if (this.images) this.work = (this.work || Promise.resolve()).then(() => invoke('release_document_images', { owner:this.scope })).then(() => {}).catch(() => {});
    this.schedule();
  }
  add(source: string): void {
    const reference = referencePath(source);
    if (!reference || reference.length > 2048) return;
    this.images ??= new Map();
    let entry = this.images.get(reference);
    if (!entry) {
      if (this.images.size >= 512) return;
      this.images.set(reference, entry = { count:0, nodes:new Set() });
      this.dirty = true; this.epoch++;
    }
    entry.count++; this.zero?.delete(reference);
    this.schedule();
  }
  remove(source: string): void {
    const reference = referencePath(source), entry = reference && this.images?.get(reference);
    if (!entry) return;
    if (--entry.count === 0) { (this.zero ??= new Set()).add(reference as string); this.schedule(); }
  }
  bind(node: HTMLImageElement): void {
    const reference = referencePath(node.dataset.litemdImage || '');
    const entry = reference && this.images?.get(reference);
    if (!entry) { node.title = 'Image unavailable or image-reference limit reached'; return; }
    (node as ImageElement)[IMAGE_TITLE] = node.getAttribute('title') || '';
    entry.nodes.add(node);
    this.apply(node, entry);
  }
  unbind(node: HTMLImageElement): void {
    const reference = referencePath(node.dataset.litemdImage || '');
    if (reference) this.images?.get(reference)?.nodes.delete(node);
  }
  private apply(node: HTMLImageElement, entry: ImageEntry): void {
    if (entry.refreshing) return;
    if (entry.url) {
      const source = node.dataset.litemdImage || '', at = source.indexOf('#');
      const url = entry.url + (at < 0 ? '' : source.slice(at));
      if (node.getAttribute('src') !== url) node.src = url;
      const title = (node as ImageElement)[IMAGE_TITLE];
      if (title) node.title = title; else node.removeAttribute('title');
      node.classList.remove('litemd-image-unavailable');
    } else if (entry.error || !this.path) {
      node.removeAttribute('src');
      node.title = entry.error || 'Save the document to give relative images a folder';
      node.classList.add('litemd-image-unavailable');
    }
  }
  private schedule(): void {
    if (this.queued || this.disposed) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.suspended || this.disposed) return;
      for (const reference of this.zero || []) {
        if (this.images?.get(reference)?.count === 0) { this.images.delete(reference); this.dirty = true; this.epoch++; }
      }
      this.zero?.clear();
      if (!this.dirty) return;
      this.dirty = false;
      this.work = (this.work || Promise.resolve()).then(async () => {
        if (this.disposed) return;
        const path = this.path, epoch = this.epoch, references = [...(this.images?.keys() || [])];
        if (!references.length || !path) {
          await invoke('release_document_images', { owner:this.scope }).catch(() => {});
          this.images?.forEach(entry => entry.nodes.forEach(node => this.apply(node, entry)));
          return;
        }
        let resolutions: Resolution[];
        try { resolutions = await invoke<Resolution[]>('sync_document_images', { owner:this.scope, documentPath:path, references }); }
        catch { resolutions = references.map(reference => ({reference,key:null,version:'',error:'Image unavailable or not authorized'})); }
        if (this.disposed || this.epoch !== epoch || this.path !== path) return;
        for (const result of resolutions) {
          const entry = this.images?.get(result.reference);
          if (!entry) continue;
          // Versions change only after an actual file change; unchanged images reuse their URL.
          entry.url = result.key ? convertFileSrc(result.key, 'litemd-image') + '?v=' + result.version : undefined;
          entry.refreshing = false;
          entry.error = result.error || undefined;
          entry.nodes.forEach(node => this.apply(node, entry));
        }
      }).catch(() => {});
    });
  }
  dispose(): void {
    this.disposed = true; this.epoch++;
    this.images?.clear(); this.zero?.clear();
    if (!this.images) return;
    // Release after any outstanding authorization, preventing a late reply from reviving it.
    this.work = (this.work || Promise.resolve()).then(() => invoke('release_document_images', { owner:this.scope })).then(() => {}).catch(() => {});
  }
}
export function documentResources(document: RenderDocument): DocumentResources {
  return document.resources ??= new DocumentResources(document.filePath);
}
function rootScope(container: HTMLElement, resources: DocumentResources): string {
  return resources.scope + (container.id === 'inline-canvas' ? '-inline' : '-split');
}
export function prepareDocumentRoot(container: HTMLElement, document: RenderDocument, clearOnChange = false): void {
  const root = container as RootElement;
  if (root[DOCUMENT] !== document) {
    for (const child of Array.from(container.children)) releaseBlockPresentation(child as HTMLElement);
    if (clearOnChange) container.replaceChildren();
    root[DOCUMENT] = document;
    if (document.resources) root.setAttribute('data-litemd-document', rootScope(root, document.resources));
    else root.removeAttribute('data-litemd-document');
  }
  document.resources?.setPath(document.filePath);
}
export function deactivatePresentationRoot(container: HTMLElement): void {
  for (const element of Array.from(container.children) as HTMLElement[]) {
    if (!releaseBlockPresentation(element)) continue;
    element.replaceChildren();
    element.removeAttribute('data-block-hash');
    element.removeAttribute('data-content-hash');
  }
}
export function blockPresentation(element: HTMLElement): BlockPresentation | undefined {
  return (element as BlockElement)[BINDING]?.metadata;
}
export function releaseBlockPresentation(element: HTMLElement): Binding | undefined {
  const block = element as BlockElement, binding = block[BINDING];
  if (!binding) return;
  binding.nodes.forEach(node => binding.resources.unbind(node));
  binding.references.forEach(source => binding.resources.remove(source));
  delete block[BINDING];
  return binding;
}
export function bindBlockPresentation(element: HTMLElement, document: RenderDocument, metadata: BlockPresentation, previous?: Binding): void {
  if (!metadata.features) return;
  const resources = documentResources(document);
  const scope = element.parentElement ? rootScope(element.parentElement, resources) : resources.scope;
  element.parentElement?.setAttribute('data-litemd-document', scope);
  resources.setPath(document.filePath);
  const references = metadata.images || [];
  references.forEach(source => resources.add(source));
  const nodes: HTMLImageElement[] = [];
  if (metadata.features & IMAGE_FEATURE) {
    const reusable = previous?.resources === resources ? [...previous.nodes] : [];
    for (let node of Array.from(element.querySelectorAll<HTMLImageElement>('img[data-litemd-image]'))) {
      const index = reusable.findIndex(old => old.dataset.litemdImage === node.dataset.litemdImage);
      if (index >= 0) {
        const old = reusable.splice(index, 1)[0];
        for (const attribute of Array.from(old.attributes)) if (attribute.name !== 'src' && !node.hasAttribute(attribute.name)) old.removeAttribute(attribute.name);
        for (const attribute of Array.from(node.attributes)) old.setAttribute(attribute.name, attribute.value);
        node.replaceWith(old); node = old;
      }
      resources.bind(node); nodes.push(node);
    }
  }
  if (metadata.features & STYLE_FEATURE) {
    for (const holder of Array.from(element.querySelectorAll<HTMLTemplateElement>('template[data-litemd-author-style]'))) {
      const css = safeStyles(holder.content.textContent || '', scope);
      const style = window.document.createElement('style');
      // Reuse the trusted shell style nonce; do not weaken the application's style CSP.
      style.nonce = window.document.querySelector<HTMLStyleElement>('head style[nonce]')?.nonce || '';
      style.textContent = css;
      holder.replaceWith(style);
    }
  }
  (element as BlockElement)[BINDING] = { resources, references, nodes, metadata };
}
