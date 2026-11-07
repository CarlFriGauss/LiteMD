/** Prevent startup autosave/close from writing until the disk session is restored. */
export class SessionStartup {
  private ready = false;
  private resolve!: () => void;
  private readonly restored = new Promise<void>((resolve) => { this.resolve = resolve; });

  get isReady(): boolean { return this.ready; }

  finish(): void {
    this.ready = true;
    this.resolve();
  }

  afterRestore(write: () => Promise<void>): Promise<void> {
    return this.ready ? write() : this.restored.then(write);
  }
}
