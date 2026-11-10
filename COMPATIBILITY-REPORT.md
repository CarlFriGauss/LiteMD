# LiteMD 0.1.1 compatibility engineering report

Date: 10 November 2026. Scope: local document images and restricted presentation HTML/CSS in the existing Rust/Tauri v2, vanilla TypeScript, markdown-it, and offline KaTeX application.

## Root causes

Markdown image tokens previously emitted relative `src` values into the application origin. They were resolved against the bundled frontend, rather than the active Markdown file's directory. The document path was not connected to preview resource resolution. The existing CSP's `asset:` entry did not enable Tauri's asset protocol or authorize files.

`markdown-it` deliberately used `html: false`. Consequently, document HTML was escaped and stylesheets could not be applied. Enabling unrestricted passthrough would have exposed the application DOM and its native IPC privileges to document markup.

## Implementation and resource lifecycle

- `src-tauri/src/document_images.rs`: exact, read-only, revocable image capabilities; asynchronous native protocol responses; path, handle, extension, and signature validation; bounded registry and file sizes; HTTP caching headers. Existing native file authorization is a prerequisite.
- `src-tauri/src/lib.rs`: registers `litemd-image` and two narrow image-capability commands. No web server, new crate, decoding library, scanner, or image watcher.
- `src/lib/documentResources.ts`: lazy per-document reference counts, bounded resolution cache, native `convertFileSrc` URLs, source/path invalidation, tab activation revalidation, close revocation, and unchanged image-node reuse. Image bytes never cross command IPC.
- `src/lib/presentation.ts`: inert native HTML parsing and reconstruction from allowlists; native CSSOM parsing and declaration/selector filtering; document-and-engine scoped nonce-bearing styles. Optional parser objects are allocated on first use and emptied after parsing.
- `src/lib/htmlBlocks.ts`: retains balanced presentation blocks across blank lines using the existing Markdown library's tag lexer. This detects block boundaries; it is not the security filter.
- `src/lib/renderer.ts`: optional HTML-token filtering and image metadata within the existing five-stage pipeline and bounded block memoization. Plain unchanged blocks bypass this work. Footnote image metadata follows the same resource lifecycle.
- `src/main.ts`: connects each preview to its actual document path, disposes switched/closed DOM bindings, and reuses unchanged Engine B wrappers. An editing block is recreated when its source range moves, keeping its source-splice callback correct. Also corrects an existing close-tab snapshot fallback that could copy an unsaved tab's empty file path into a remaining tab.
- `src/lib/mathNormalizer.ts`: strips the opening blockquote's nesting markers from display-math payload lines while retaining genuine greater-than relations, quote structure, and source-line counts.
- `src/styles/app.css`: document containment and unavailable-image presentation. Existing UI, themes, shortcuts, installer hooks, and assets are retained.
- Package, Cargo, and Tauri version fields move together to 0.1.1. Dependency lists and lockfile dependency versions are unchanged.

## Official application logo

The selected second design, `D:\Artcraft\VectorCraft\app_logos\LiteMD-Icon1.png`, is retained byte-for-byte as `src-tauri/icons/LiteMD-Icon1.png` (512×512, 8-bit RGBA; SHA-256 `e6701942de5910aed42ea90f0078dc2adb83fd7b3c530b7c7499547a10c67fb4`). The installed Tauri CLI's existing `icon` command generated `icon.ico`, `32x32.png`, `128x128.png`, and `128x128@2x.png`. No fit/crop/background/recolor options or image-editing tools were used. Only the four configured Windows icon outputs and the selected original source are retained in the repository. A single `build.rs` dependency line ensures that changing `icon.ico` also regenerates the cached Windows resource. NSIS's existing `installerIcon` and `uninstallerIcon` settings explicitly select this ICO; otherwise NSIS keeps its generic icon. The executable and NSIS installer are rebuilt after generation; shortcut targets continue to use the application's embedded icon. Raw Windows icon resources are compared with all six generated ICO frames, avoiding misleading differences caused by Windows' choice or resampling of a display frame.

## Supported compatibility and intentional limits

SVG, PNG, JPEG/JPG, GIF, and WebP load through ordinary image elements using native WebView2 decoding. Same-directory and subdirectory paths, spaces, Unicode, Markdown images, HTML images, and images in footnotes are supported. Existing HTTP/HTTPS image behavior is retained. Unsaved documents display an explanatory placeholder until saved; missing or rejected images do not interrupt editing.

Local references must remain below the saved document's canonical directory. Absolute/UNC paths, parent traversal, alternate streams, junction escapes, wrong file types, and unauthorized documents are rejected. Budgets: 32 MiB per file, 512 unique references per document, 2,048 authorized images across open documents. No image data is retained in the native capability registry. A file change is checked on tab reactivation/reopening; no new background polling is introduced. Metadata-based cache versions do not detect changes deliberately preserving both file length and modification time.

Presentation elements include small/strong/emphasis/span, paragraphs, headings, div/section, figure/figcaption/img, lists, blockquotes, and basic tables. Styles support colors, typography, spacing, borders, size constraints, alignment, and simple flex layouts. Tag/class selectors, descendants, children, and comma groups are supported. Rules target author-written HTML only, within the active document and engine; they do not restyle generated Markdown or KaTeX internals. Markdown inside HTML follows markdown-it's ordinary HTML-block semantics; raw TeX placeholders can render within supported text elements.

Full web pages, interactive HTML, scripts, forms, frames, inline SVG/MathML, arbitrary attributes, event handlers, CSS imports/resource URLs/variables/at-rules/pseudo selectors/id selectors/attribute selectors/animations/fixed positioning are intentionally excluded. Use Markdown links and fenced code. HTML budgets are 65,536 UTF-16 code units, 512 nodes, and 32 levels per fragment; stylesheets are limited to 32,768 code units and 128 rules. Native image handles currently support Windows and Linux; other platforms fail closed until a platform-specific handle check is implemented. Windows is the tested release target.

## Security boundaries

The new protocol is an in-process Tauri URI handler, not an embedded HTTP server. It accepts opaque capability keys, never arbitrary requested paths. Authorization is limited to actual referenced image files, cannot grant Markdown read/write access, and is revoked when references/documents are removed. Canonical containment is checked initially, then the opened Windows file handle's final path is checked again before serving bytes, including after a junction replacement. Responses use fixed image MIME types, `nosniff`, restrictive CSP, and conditional ETags.

The built-in asset protocol remains disabled with no blanket filesystem scope. Tauri's documented `convertFileSrc` requirements were checked against the installed API 2.12.4 and native crate 2.12.5; its custom-protocol argument is used for the revocable registry. This avoids a growing non-revocable directory/file allowlist. Author HTML lists remain noninteractive presentation; Markdown task-list conversion is limited to Markdown-generated items with their existing source mappings.

SVG is loaded as an image, never injected into the DOM. HTML is parsed in an inert template, and CSS in a detached stylesheet, then reconstructed from explicit allowlists. Untrusted `<style>` content is never inserted unscoped. No unsafe script permission or application UI selector access is added. Attribute math placeholders are restored to escaped source text, preventing generated KaTeX markup from entering attributes. The existing script policy and KaTeX `trust: false` remain enforced; object/frame/base/form restrictions are tightened.

References: [Tauri convertFileSrc](https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc), [Tauri asset protocol](https://v2.tauri.app/security/asset-protocol/), and [SVG secure image modes](https://www.w3.org/TR/SVG2/conform.html#secure-static-mode).

## Measurements

Final runtime measurements (Windows x64, system WebView2; old 0.1.0 versus local 0.1.1) are below. Memory uses warmed launches; input percentiles use all recorded edits. Three-tab memory is measured after visiting every tab. Raw final data are `bench-shipping-before-a/b` and `bench-final-after-a/b` under `.cache/compat-2026-11-10/`; earlier superseded/helper-smoke data are excluded.

| Engine / workload | Launches per version | Warm private MiB, old → new | Summed working-set MiB, old → new | Input p50 / p95 ms, old → new |
|---|---:|---:|---:|---:|
| A / Idle | 7 | 153.5 → 153.3 | 364.6 → 365.0 | 1.6 / 5.4 → 2.1 / 5.4 |
| A / Plain Markdown | 3 | 170.7 → 174.1 | 387.0 → 390.5 | 7.6 / 18.9 → 4.0 / 12.3 |
| A / 360 expressions | 3 | 287.4 → 287.5 | 505.7 → 507.8 | 19.8 / 68.2 → 14.5 / 32.0 |
| A / Three tabs | 11 | 438.4 → 435.4 | 671.8 → 671.5 | 4.4 / 12.9 → 4.8 / 16.4 |
| B / Idle | 3 | 162.7 → 152.4 | 386.7 → 363.5 | 1.0 / 3.0 → 1.3 / 3.1 |
| B / Plain Markdown | 3 | 171.2 → 168.5 | 390.0 → 385.2 | 2.7 / 7.1 → 3.9 / 7.9 |
| B / 360 expressions | 3 | 277.7 → 277.4 | 501.4 → 494.8 | 10.7 / 39.5 → 9.7 / 19.3 |
| B / Three tabs | 3 | 392.4 → 395.8 | 626.1 → 630.8 | 3.4 / 8.8 → 3.3 / 8.9 |

| Engine / workload | Fresh-profile ready proxy, old → new (s) | Warm median, old → new (s) | Warm range, old / new (s) |
|---|---:|---:|---|
| A / Idle | 6.2 → 5.1 | 1.3 → 1.3 | 0.9–2.8 / 1.0–2.4 |
| A / Plain Markdown | 5.3 → 4.9 | 1.8 → 1.6 | 1.4–2.1 / 1.4–1.9 |
| A / 360 expressions | 10.4 → 5.5 | 4.6 → 3.0 | 2.0–7.2 / 1.6–4.3 |
| A / Three tabs | 4.3 → 4.2 | 1.0 → 1.3 | 0.9–1.7 / 1.0–5.0 |
| B / Idle | 5.6 → 5.7 | 1.0 → 1.2 | 1.0–1.1 / 1.0–1.4 |
| B / Plain Markdown | 6.8 → 6.7 | 1.2 → 1.3 | 1.0–1.5 / 1.3–1.4 |
| B / 360 expressions | 4.5 → 6.2 | 1.7 → 1.7 | 1.6–1.9 / 1.6–1.7 |
| B / Three tabs | 6.3 → 6.6 | 1.1 → 1.6 | 1.1–1.1 / 1.0–2.3 |

The split-pane three-tab pooled switch median was 61.8 → 77.0 ms across batches with varying host load. Four additional closely alternating warm pairs gave **69.2 → 64.0 ms**, input medians 4.3 → 4.4 ms, and private memory 437.9 → 428.9 MiB. Those controls did not reproduce a consistent split-pane slowdown. Both pooled and paired results are retained; they do not justify a universal latency or startup improvement claim.

A genuine intermediate Engine B switch regression was corrected by clearing the previous document's canvas in one operation on document changes. Same-document edits still reuse unchanged blocks. Final Engine B pooled switch median: 57.2 → 60.9 ms; p95: 1330.9 → 1112.0 ms. In the mathematics document, committing the inline edit with Escape took a median **123.1 → 3.1 ms**; unchanged equation nodes now survive that commit.

Private-memory differences were small and mixed in sign. Input and launch timings varied by workload and host load; the raw distributions and paired controls are more informative than a blanket “unchanged” claim. The additional HTML/CSS parsers, image reference maps, and native image file reads remain absent from the ordinary-document editing path. The existing whole-document block-boundary pass is retained; this change does not claim a new parser complexity bound.

| Local artifact | Before | After | Change |
|---|---:|---:|---:|
| Production executable | 5,235,200 B | 5,311,488 B | +76,288 B (+1.46%) |
| Frontend JavaScript | 462,869 B | 479,294 B | +16,425 B (+3.55%) |
| Frontend CSS | 42,200 B | 42,396 B | +196 B (+0.46%) |

The locally generated NSIS installer is 2,384,806 bytes. Runtime dependency lists are unchanged. CI uses its existing standard Windows compiler environment, so published executable/installer bytes may differ from these local-toolchain sizes; their source version and functionality are verified separately before publication.

The benchmark uses the old installed production executable and the updated locally built production executable with isolated D: profiles, identical source fixtures, and no compiler running. The old binary came from CI; the new local binary uses this host's documented existing linker/toolchain adapters, so this is a runtime version comparison, not an experiment isolating compiler effects. It includes an almost-empty idle document, ordinary Markdown, 120 mathematical sections (360 rendered expressions), and three open tabs. Memory includes LiteMD and its relevant WebView2 child/profile processes, excluding the sampler. Process creation times guard against reused Windows parent PIDs and PID recycling during a sample. Private committed bytes are the primary memory figure; summing working sets double-counts shared pages. Each launch takes three memory samples, twenty verified native edits paced externally at 25 ms, and twelve tab switches where applicable. Three-tab memory is also sampled after all tabs have been visited. Samples are reported as medians and p95 where useful. Edit timings measure synchronous input handling and preview DOM updates, not paint-to-photon latency; pacing outside WebView avoids dependence on animation-frame throttling in occluded windows.

Document-ready timing includes process launch, WebView initialization, session restoration, and CDP readiness. It is not a first-paint measurement. Paint Timing entries were unavailable for this native application origin. Fresh profiles are distinguished from reused profiles; no reboot or OS file-cache eviction was performed, so a true cold-boot measurement is unavailable. Host load introduces considerable launch-time variability. Initial sampler results that included the PowerShell measurement process were discarded and repeated.

## Verification

Baseline before implementation: 35 frontend tests and 7 native tests passed. The final frontend suite adds compatibility, URL/attribute, footnote-resource, quoted-math, block-boundary, and source-line regression cases. Native file-capability tests cover exact authorization, revocation/reopening, cross-owner preservation, path and format rejection, spaces/Unicode/formats, and ETag responses.

`scripts/verify-native-rendering.mjs` exercises the production Windows Tauri/WebView2 runtime with synthetic isolated documents, actual SVG/bitmap decoding, hostile markup/CSS/SVG, unsafe paths, junction escapes and post-authorization replacement, tab-directory separation, unsaved-document behavior, changed image revalidation, HTTP caching, footnotes, math, fenced HTML, line mappings, stylesheet isolation between engines, and unchanged image/equation identity with zero caption-edit image IPC. `scripts/benchmark-native.mjs` provides the matched performance workload without additional packages.

Executed local checks:

- 49 frontend tests passed; 10 Rust unit tests passed; native formatting passed. Dependency versions are unchanged.
- 37 production Windows/WebView2 regression cases passed on the executable extracted from the final NSIS installer, then all 37 passed on the installed executable using isolated test data. The long mixed-document case preserves all 240 equation nodes and the unchanged image during a caption edit, with zero image-resolution IPC.
- Native keyboard/editing checks passed for Tab/slash/task-list/external-reload undo, native save, external conflict cancellation, close cancellation/confirmation, and unsaved-draft caching.
- NSIS payload extraction produced an executable with the exact production SHA-256. All six icon frames in both application and setup match the generated official ICO. The running installed window's 32×32 icon was exported and visually verified against the second white/red design.
- Ordinary in-place upgrade to `D:\Apps\LiteMD` succeeded after full installation/data backups. The installed executable matched the tested production payload. The installer left the session file and all four existing saved-document files byte-for-byte unchanged, retained the data location, and preserved unrelated PATH entries. There were no separate custom theme files; the cached theme/settings were preserved and checked on restoration.
- Actual Start menu and desktop shortcut launches succeeded. Each restored five tabs and the one unsaved draft exactly, with matching theme, engine, layout, and line-number settings. One clean tab reloaded newer on-disk text through the existing external-reload behavior; that text was independently checked against its saved file. No user Markdown file was edited by these verification actions. Verification windows closed through the normal cache-flushing close handler.

Initial native checks exposed issues in CSS border shorthand handling, decoded-image refresh, tab-close snapshot selection, footnote/attribute handling, and source-range reuse; these were corrected before the final successful runs. Performance testing also caught the Engine B cross-document canvas slowdown described above. Windows sandbox execution prevented the 32-bit NSIS tool from starting; the same existing tool succeeded under normal Windows execution permissions, without installing or replacing a toolchain.

Not measured or exhaustively tested: true OS-cold startup, paint-to-photon latency, physical printer/PDF output, every possible SVG construct, animated GIF/WebP timing, or non-Windows application execution. Image file size limits do not bound the native decoder's pixel-memory requirements. SVG is an image context with restrictive subresource policy; scripts and external resource references are blocked. Math retains LiteMD's selected math typography/color rather than arbitrary author stylesheet rules.

Local production executable: `target/release/litemd.exe`; installed executable: `D:\Apps\LiteMD\litemd.exe`; NSIS installer: `target/release/bundle/nsis/LiteMD_0.1.1_x64-setup.exe`. Rollback installation and user data are retained under `.cache/compat-2026-11-10/rollback` and the newer `local-upgrade-backup-*` directory. Detailed private test logs and snapshots remain outside source control.

Distribution uses the existing Windows Actions workflow and a new `v0.1.1` tag. It additionally gates publication on a clean Windows install/uninstall and data-preservation test, downloadable checksums, and verification of the actual release artifacts. See the [versioned release](https://github.com/CarlFriGauss/LiteMD/releases/tag/v0.1.1) for the published installer and final release validation. Published CI artifacts are verified separately from the local-toolchain measurements above. No claim is made that this scoped test matrix proves the absence of every application bug.
