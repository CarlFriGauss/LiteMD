/**
 * LiteMD — Native Rust Tauri v2 IPC Bridge
 *
 * Calls the Rust backend commands implemented in `src-tauri/src/lib.rs`:
 * - `read_markdown_file(path)`
 * - `save_markdown_file(path, content)`
 * - `get_cli_file_arg()`
 * - `get_file_mtime(path)`
 * - `pick_open_markdown_file(initialDir)`
 * - `pick_save_markdown_file(defaultPath)`
 * - `save_custom_theme_json(name, jsonContent)`
 * - `list_custom_themes()`
 */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface CustomThemeRecord {
  name: string;
  path: string;
  json: string;
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export async function readMarkdownFile(path: string): Promise<string> {
  return await invoke<string>('read_markdown_file', { path });
}

export async function saveMarkdownFile(
  path: string,
  content: string
): Promise<number> {
  return await invoke<number>('save_markdown_file', { path, content });
}

export async function getCliFileArg(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<string | null>('get_cli_file_arg');
  } catch {
    return null;
  }
}

export async function getFileMtime(path: string): Promise<number> {
  if (!isTauriRuntime()) return 0;
  try {
    return await invoke<number>('get_file_mtime', { path });
  } catch {
    return 0;
  }
}

export async function pickOpenMarkdownFile(
  initialDir?: string
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return await invoke<string | null>('pick_open_markdown_file', {
    initialDir: initialDir ?? null,
  });
}

export async function pickSaveMarkdownFile(
  defaultPath?: string
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return await invoke<string | null>('pick_save_markdown_file', {
    defaultPath: defaultPath ?? null,
  });
}

export async function saveCustomThemeOnD(
  name: string,
  jsonContent: string
): Promise<string> {
  if (isTauriRuntime()) {
    return await invoke<string>('save_custom_theme_json', {
      name,
      jsonContent,
    });
  }
  return `themes/${name}.json`;
}

export async function listCustomThemesOnD(): Promise<CustomThemeRecord[]> {
  if (!isTauriRuntime()) return [];
  try {
    return await invoke<CustomThemeRecord[]>('list_custom_themes');
  } catch {
    return [];
  }
}

export async function saveSessionStateOnD(sessionJson: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke<void>('save_session_state', { sessionJson });
  } catch {
    // Ignore transient disk errors; localStorage mirror is also active
  }
}

export async function loadSessionStateFromD(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<string | null>('load_session_state');
  } catch {
    return null;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await invoke<void>('open_external_url', { url });
      return;
    } catch (error) {
      window.alert(`Could not open the link: ${String(error)}`);
      return;
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function registerWindowCloseGuard(
  hasUnsavedTabs: () => boolean,
  onFlushSession: () => void | Promise<void>
): void {
  if (!isTauriRuntime()) return;
  try {
    void getCurrentWindow().onCloseRequested(async (event) => {
      await onFlushSession();
      if (
        hasUnsavedTabs() &&
        !window.confirm(
          'You have unsaved changes in open tabs. Close LiteMD without saving to disk? (Your draft is also backed up in the session cache.)'
        )
      ) {
        event.preventDefault();
      }
    }).catch(() => {
      // Registration errors are asynchronous.
    });
  } catch {
    // Ignore if close listener permission is not configured
  }
}

export async function updateNativeWindowTitle(
  filePath: string | null,
  isDirty: boolean
): Promise<void> {
  const filename = filePath
    ? filePath.split(/[\\/]/).pop() || filePath
    : 'Untitled.md';
  const prefix = isDirty ? '● ' : '';
  const fullTitle = `${prefix}${filename} — LiteMD`;
  document.title = fullTitle;

  if (isTauriRuntime()) {
    try {
      await getCurrentWindow().setTitle(fullTitle);
    } catch {
      // Ignore if window title permission is unavailable
    }
  }
}
