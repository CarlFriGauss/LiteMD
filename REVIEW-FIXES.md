# Review fixes — November 7, 2026

The committed working version and the subsequent safety improvements are retained together with the rendering, closing, and selection repairs.

## Confirmed causes of the reported regressions

- **Broken equations:** the running application reported 1,420 blocked inline-style operations during the diagnostic startup/reload. Tauri adds a nonce to `style-src`; Chromium then ignores that directive's `'unsafe-inline'` allowance. KaTeX's spacing, heights, and superscript positions were blocked. The policy now explicitly allows `style-src-attr 'unsafe-inline'` while retaining script restrictions.
- **Window would not close:** the running application returned `Command plugin:window|destroy not allowed by ACL`. Tauri's close-request listener calls this command after the handler approves closing. The main-window capability now grants `core:window:allow-destroy`.
- **Original compiler error:** yesterday's terminal output was unavailable. The current source successfully built before these repairs, so that original fatal compiler error has not been reproduced. The observed long-section-name linker messages are warnings; they did not prevent successful builds.
- **Boxed/aligned equation lost its tag:** the delimiter regex rejected the outer display block when it encountered valid row-spacing syntax such as `\\[4pt]`. It then rendered only the inner environment. A linear escape-aware scanner now preserves the entire expression. Sixteen regression cases cover the reported equation, spacing variants, blank lines, escaped delimiters, incomplete openers, and inline environments. The rebuilt native app visibly renders the box and `(11.4.3)` correctly.

- **Fresh-profile recovery race:** startup UI initialization scheduled autosave before the asynchronous disk-session read finished. A fresh WebView profile could replace existing drafts with the welcome buffer. Persistence and early closing now wait for recovery, and fresh-profile editing stays inactive until recovery completes. Three regression tests cover pending recovery, an early close, and normal saves. Native verification recovered all three real draft tabs and the reported equation from a fresh profile; the original session backup was retained.

## Checklist against the supplied review

“Automated” below identifies behavior covered by tests; “native check pending” identifies behavior that still requires Windows UI verification. Code inspection alone is not a passed UI test.

| Review item | Implementation and evidence |
| --- | --- |
| Malicious raw HTML | HTML passthrough disabled; fenced code escaped, including unfinished fences. Automated rendering tests. |
| Trusted KaTeX links/macros | `trust: false`; malicious-link rendering test passes. |
| CSP and public Tauri globals | CSP retained, style-attribute correction applied, `withGlobalTauri: false`. Native equation layout verified with zero blocked inline styles in the isolated check. |
| Arbitrary file reads/writes | Dialog/CLI/session file capabilities and blocked script/startup paths. Rust rejection tests. A frontend-written session cannot grant new file capabilities. |
| Single-line and empty code blocks | Protection corrected and covered by rendering/source-line tests. |
| Apostrophes and Rust lifetimes | Tokenize before HTML escaping; automated rendering test. |
| Inline-code math delimiters collapsing blocks | Splitter ignores protected delimiters; automated 51-block test. |
| Closing unsaved tabs/window | Close guard retained, destroy permission corrected, session writes awaited and ordered. Native confirmation/cancel paths pass, and the final unsaved edit reaches the disk snapshot before closing. Fresh-profile recovery preserves all three real draft tabs. |
| Preview link navigation | Click handling prevents app navigation and opens allowed URLs externally. Windows uses the native shell API; native link-opening check pending. |
| External edit conflicts | All file-backed tabs checked; saving compares disk timestamps; asynchronous reload cannot replace intervening edits. Native active-document conflict cancellation preserves both the external file and the unsaved buffer. Inactive-tab native checking remains pending. |
| Engine B blank lines/trailing newline | Block-only string splice preserves outside content, including CRLF. Automated source-splice tests. |
| Undo after Tab/slash/checkbox/reload | Undo-preserving insertion used; reload no longer assigns the active textarea value directly. Native Engine A Ctrl+Z checks pass for all four operations; Engine B native verification remains pending. |
| Atomic saving | Unique sibling temp file, flush, then rename. Failed replacement preserves the original. Rust replacement and failure tests. Session saves use the same helper. |
| Cache invalidation after line insertion | Relative line offsets and content-only cache keys retained. Automated cache-hit/source-line test. |
| Whole-editor work per keystroke | Reuses highlight spans, cached word counts, wrap measurements, gutter nodes, and title/tab updates. Automated test proves one changed highlight span for a one-paragraph edit in 1,500 paragraphs. Pixel alignment and latency still need native measurement. |
| Unmeasured README promises | Removed unverified timing/size and absolute security claims. Startup and memory use remain measurement requirements. |
| Hardcoded machine build configuration | Both local Cargo configs kept on disk and excluded from Git; npm cache path is relative; environment paths derive from the project/user profile. Building on another Windows machine remains untested. |
| Runtime storage without D: | Existing configurable/fallback storage retained. This machine continues to use D: as required. A machine without D: has not been tested. |
| Exposed Windows username | Environment script uses `USERPROFILE`. |
| Hebrew/RTL | Auto direction on rendered blocks and both editing surfaces; math/code stay left-to-right. Native mixed-direction check pending. |
| Windows-1255 and UTF-16 files | Decoder retained; automated Rust encoding test. |
| License | MIT `LICENSE` retained. |
| Unreadable text selection | Selected characters use the editor foreground over a translucent highlight. Native light/dark checks include mixed English/Hebrew text; measured contrast exceeds 11:1 in both default themes. |
| Test gaps | Frontend tests now include code, security, block splitting, source preservation, and incremental editor behavior. Rust tests cover I/O, failed replacement, encoding, file security, and session authorization. |

No runtime dependencies were added. Release optimization settings (`lto = "fat"`, one codegen unit, optimized/stripped binary) are retained.

## Verification boundary

Completed checks: 35 frontend tests on the updated renderer/session initialization, 7 Rust tests on the backend, TypeScript/Vite production build, Rust release build, Rust formatting, and Git whitespace checks. All passed. The linker emitted long-section-name warnings, with no build failure.

The final executable is `target/release/litemd.exe`: **5,233,664 bytes (4.991 MiB)**. This is a measured file size, not a startup or memory benchmark. Dependency manifests and lockfiles are unchanged.

An earlier Windows UI check was stopped with Escape. Verification resumed after the user requested reopening the application. Opening, equation layout, the reported box/tag, clean native closing, and restoration of all three real tabs/drafts are now verified. Undo, explicit confirmation/cancel dialogs, link launching, and interactive conflict handling still require native checks.

For the tag repair, current evidence is in `.cache/tag-regression-before.log`, `.cache/tag-regression-after.log`, `.cache/tag-frontend-build.log`, `.cache/tag-release-build.log`, `.cache/tag-native-verification.json`, and `.cache/tag-restored-session-verification.json`. The verified screenshot is `.cache/tag-native-verified.png`. The corrected executable has been opened with the user's normal session restored, and the reported tag also renders correctly in that actual document.

Build/test transcripts are retained under `.cache/repair-audit-frontend-tests.log`, `.cache/repair-audit-frontend-build.log`, `.cache/repair-audit-rust-tests.log`, and `.cache/repair-final-build.log`. The original uncommitted diff was backed up under `.cache/repair-backup-2026-11-07/` before repairs.

Selection verification: `.cache/selection-native-verification.json`, `.cache/selection-light.png`, `.cache/selection-dark.png`, and `.cache/selection-release-build.log`. The selected foreground is opaque and the highlight has 60% opacity; the fixture was not modified and its native window closed successfully.

## Windows distribution

The per-user NSIS installer adds Start menu/desktop shortcuts and offers terminal PATH integration. No new runtime package or background service was added. Installer tools are cached under the project target directory. User data defaults to `com.litemd.editor` under LOCALAPPDATA, separate from the executable; the existing D: workspace and custom `LITEMD_DATA_DIR` remain supported.

Local verification passed: installer/portable executable SHA-256 equality, shortcuts pointing to the installed executable, PATH registration and cleanup, and preserving a user-data sentinel through uninstall. PATH registry tests cover values longer than 8 KiB, repeated installation, pre-existing entries, later user edits, and an originally missing value. Evidence: `.cache/installer-local-smoke.log`, `.cache/installer-rust-tests.log`, `.cache/installer-release-build.log`, and `.cache/installer-bundle.log`. The updated backend's seven Rust tests pass. The GitHub workflow repeats the suites and installer checks on a clean Windows runner before uploading artifacts or creating a draft release.
