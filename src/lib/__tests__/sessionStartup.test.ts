import { describe, expect, it } from 'vitest';
import { SessionStartup } from '../sessionStartup';

describe('startup session preservation', () => {
  it('does not overwrite an existing session while the disk read is pending', async () => {
    const startup = new SessionStartup();
    let editor = 'default welcome text';
    let disk = 'three existing unsaved drafts';
    const writes: string[] = [];
    const earlyAutosave = startup.afterRestore(async () => { writes.push(editor); disk = editor; });
    await Promise.resolve();
    expect(writes).toEqual([]);
    expect(disk).toBe('three existing unsaved drafts');
    editor = disk;
    startup.finish();
    await earlyAutosave;
    expect(disk).toBe('three existing unsaved drafts');
    expect(writes).toEqual(['three existing unsaved drafts']);
  });

  it('keeps an early close pending until restoration and its final flush finish', async () => {
    const startup = new SessionStartup();
    const order: string[] = [];
    let finishWrite!: () => void;
    const written = new Promise<void>((resolve) => { finishWrite = resolve; });
    const close = startup.afterRestore(async () => { order.push('write'); await written; })
      .then(() => { order.push('close'); });
    await Promise.resolve();
    expect(order).toEqual([]);
    order.push('restore');
    startup.finish();
    await Promise.resolve();
    expect(order).toEqual(['restore', 'write']);
    finishWrite();
    await close;
    expect(order).toEqual(['restore', 'write', 'close']);
  });

  it('runs normal saves immediately once startup has finished', async () => {
    const startup = new SessionStartup();
    startup.finish();
    let writes = 0;
    const saved = startup.afterRestore(async () => { writes++; });
    expect(startup.isReady).toBe(true);
    expect(writes).toBe(1);
    await saved;
  });
});
