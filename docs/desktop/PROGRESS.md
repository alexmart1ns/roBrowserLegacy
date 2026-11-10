# Desktop Port Progress (`docs/desktop/PROGRESS.md`)

## Current Status

- **Current Phase / Gate:** `G5` & `G6` completed -> Moving to `G7` (Launcher Asset Patcher & Safe Updater)
- **Branch:** `feat/electron-desktop-port`
- **Base Commit:** `337870b6eea50ec0f528f02116c36082f608967a`
- **Environment:** Windows 11 x64 (`10.0.26300.0`), Node `v24.15.0`, npm `11.12.1`, Electron `41.10.7`, Vite `8.3.7`, Vitest `4.1.12`, electron-builder `26.18.0`

## Completed Gates

### `G5` & `G6` — Configuration, First-Use Launcher UX, OS Integration & Stability (`PASS`)
- **Completed:**
  - Implemented versioned atomic `SettingsStore` (`applications/electron/services/settings-store.js`) in `userData/desktop-settings.json` managing assets folder, server CRUD entries (validated host/port/URL/packetver), preferences, window bounds, updates config, and debug flags without storing plaintext passwords.
  - Implemented structured `DesktopLogger` (`applications/electron/services/logger.js`) with recursive secret/password/token/auth/cookie redaction (`[REDACTED]`), bounded 500-entry ring buffer, opt-in debug file rotation (`2 MiB`), and sanitized `buildDiagnosticsSnapshot` / JSON export.
  - Built CSP-clean Desktop Launcher UI (`applications/electron/renderer/launcher.{js,css}`, `config.js`, `entry.js`, `index.html`): displays asset readiness, `DATA.INI` GRF priority, `PACKETVER`, live indexing progress (`assets.onProgress`), reindex/cache reset, server CRUD, Graphics/Audio preference sync into `localStorage` (`Audio` v1.0, `Graphics` v1.1 preserving existing post-processing keys), dynamic CSP origin reload when HTTP endpoints change, diagnostics preview/export, reset confirmation, and game launch trigger.
  - Implemented single-instance lock (`app.requestSingleInstanceLock()` focusing existing window on `second-instance`), display-safe window bounds restoration/clamping (`applications/electron/main/window-state.js`), debounced bounds persistence, native menu bar suppression on Windows/Linux (preserving `Alt+*` game hotkeys), `will-prevent-unload` clean exit handling, and validated `ro:window:*` / `ro:platform:saveScreenshot` IPC.
  - Updated shared renderer guards safely for both platforms: `Context.js` (`requestFullScreen`, `cancelFullScreen`, `resizeWindow`), `GraphicsOption.js`, `Intro/Preferences.js`, `KeyEventHandler.js` (`focus blur` modifier reset), `ScreenShot.js` (native PNG save to `Pictures/roBrowserLegacy/`), and `GameEngine.js` (friendly WebGL2 support error UI).
  - Verified with `tests/desktop/settings-logger-window.test.js` (13 tests), full `npm test` (41 files / 238 tests PASS), ESLint (0 errors on Electron/touched files), `npm run format:check` (PASS), `npm run build:all` (Web regression PASS), and two-session live packaged Electron CDP probe (`SESSION_1` Launcher -> Server add -> `1120x700` resize -> PNG screenshot validation -> engine boot `roReady: true`; `SESSION_2` cold restart verifying persisted server + `1120x700` window bounds, 0 console errors).
- **Files Added/Modified:**
  - `applications/electron/services/logger.js`, `settings-store.js`
  - `applications/electron/main/window-state.js`, `ipc-security.js`, `ipc-handlers.js`, `window-security.js`, `bootstrap.js`
  - `applications/electron/preload/preload.cjs`
  - `applications/electron/renderer/config.js`, `entry.js`, `index.html`, `launcher.js`, `launcher.css`
  - `src/Core/Context.js`, `src/Controls/KeyEventHandler.js`, `src/Controls/ScreenShot.js`, `src/Engine/GameEngine.js`, `src/UI/Components/GraphicsOption/GraphicsOption.js`, `src/UI/Components/Intro/Preferences.js`
  - `tests/desktop/settings-logger-window.test.js`

### `G4` — Local Assets, GRF, VFS & Workers (`PASS`)
- **Completed:**
  - Benchmarked Option A (Node `worker_threads` slice reader + native `node:zlib` + persistent disk index) vs Option B (slice reads + JS `Inflate`) on a 2,500-entry synthetic GRF: Option A achieved 6.50ms cold index+save, 2.55ms warm index load, 25.46ms for 500 random extractions (vs 29.92ms Option B), with 100% byte-for-byte parity. Selected Option A.
  - Defined `Platform` contract (`src/Platform/contracts/AssetProvider.js`) and `DesktopAssetProvider` (`src/Platform/desktop/DesktopAssetProvider.js`) using privileged `ro-asset://local/` streaming protocol so sandboxed Chromium Web Workers (`ThreadEventHandler`) never require Node integration.
  - Synced `Platform` path alias across `vite.config.js`, `applications/tools/builder-web.mjs`, and `applications/electron/vite.desktop.config.mjs`.
  - Implemented `grf-reader.js` (0x200/0x300 slice reader reusing `GameFileDecrypt.js`, bounds-checked against corrupt/truncated GRFs, Windows-1252/UTF-8 parity, `DATA.INI` numeric parser, PE timestamp `PACKETVER` detector), `asset-index-cache.js` (versioned SHA-256 disk cache in `userData`), `local-asset-vfs.js` (loose files `data/`, `BGM/`, `System/`, `AI/` > `DATA.INI` > size-sorted GRFs; symlink containment), `asset-worker.mjs`, `asset-service.js`, and `asset-protocol.js` (Range 206 streaming + search + status + traversal guard).
  - Removed `Function('return require')()` completely from `src/Core/FileManager.js` and `src/Loaders/GameFile.js`; updated `ThreadEventHandler.js` (`initAsync`, `searchAsync`) and `Client.js` (`detectedPacketVer`); prevented `/client/` HTTP fallback on Desktop when `remoteClient` is empty.
  - Added `assets.{selectDirectory,getStatus,reindex,clearCache,onProgress}` IPC and `--assets-dir` / `RO_ASSETS_DIR` bootstrap + clean handle close on `before-quit`.
  - Verified with `tests/desktop/local-assets-vfs.test.js` (6 tests: `DATA.INI` precedence, loose overrides, 0x200/0x300 byte parity with browser `GameFile`, cache hit/invalidation, traversal/corrupt GRF resilience, worker `AssetService` + PE detection), `tests/desktop/desktop-asset-provider.test.js` (1 test), `npm test` (full suite), `npm run build:all` (Web regression PASS), and live packaged Electron CDP probe (`DATA.INI` precedence, 206 Range streaming, 20220406 PE detection, search, 403 traversal block).
- **Files Added/Modified:**
  - `src/Platform/contracts/AssetProvider.js`, `src/Platform/desktop/DesktopAssetProvider.js`
  - `src/Core/FileManager.js`, `src/Core/Client.js`, `src/Core/ThreadEventHandler.js`, `src/Loaders/GameFile.js`
  - `applications/electron/services/grf-reader.js`, `asset-index-cache.js`, `local-asset-vfs.js`, `asset-worker.mjs`, `asset-service.js`
  - `applications/electron/main/asset-protocol.js`, `bootstrap.js`, `ipc-handlers.js`, `preload/preload.cjs`, `electron-builder.yml`
  - `vite.config.js`, `applications/tools/builder-web.mjs`, `applications/electron/vite.desktop.config.mjs`
  - `tests/helpers/synthetic-grf.js`, `tests/desktop/local-assets-vfs.test.js`, `tests/desktop/desktop-asset-provider.test.js`

### `G3` — Native TCP with Packet Parity (`PASS`)
- **Completed:**
  - Implemented main-process TCP service (`applications/electron/services/tcp-service.js`) using `node:net`, `socket.setNoDelay(true)`, connect timeout (`10_000ms`), per-window socket limits (`8`), outbound backpressure cap (`4 MiB`), strict socket state machine (no duplicate `connected`/`closed`, no `closed` on pre-connect failure, no use-after-close), and zero-offset `Uint8Array` emission.
  - Implemented destination authorization policy (`applications/electron/services/network-policy.js`) requiring explicitly configured servers for `login`, binding `char`/`map` redirects to active authorized sessions, and blocking metadata/unspecified/multicast IPs (`169.254.0.0/16`, `fe80::/10`, `0.0.0.0/8`, `224.0.0.0/4`), DNS rebinding to blocked IPs, and dangerous non-RO service ports on redirects.
  - Updated `src/Network/SocketHelpers/NodeSocket.js` to consume `window.electronAPI.network` over validated IPC (removing `node:net` from preload), preserving exact `NetworkManager` contract.
  - Updated `src/Network/NetworkManager.js` (passes socket role `login|char|map`, clears `_save_buffer` & `read.callback` on close/new connect, preserves custom `_socketFactory` & `WebSocket` path) and `src/Engine/LoginEngine.js` / `src/Engine/CharEngine.js` (registers server and passes connection role).
  - Verified with `tests/desktop/network-policy.test.js` (3 tests), `tests/desktop/tcp-service.test.js` (3 tests: fragmented & concatenated binary TCP loopback, refused port, DNS rebind blocking, timeout, teardown), `tests/desktop/node-socket-network.test.js` (2 tests: RO packet fragmentation/coalescing across Login->Char transition + WebSocket fallback), and live packaged Electron CDP loopback TCP probe (`received:[129,0,42,254,16,153]`).
- **Files Added/Modified:**
  - `applications/electron/services/network-policy.js`, `applications/electron/services/tcp-service.js`
  - `src/Network/SocketHelpers/NodeSocket.js`, `src/Network/NetworkManager.js`, `src/Engine/LoginEngine.js`, `src/Engine/CharEngine.js`
  - `tests/desktop/network-policy.test.js`, `tests/desktop/tcp-service.test.js`, `tests/desktop/node-socket-network.test.js`

### `G2` — Electron Bridge & Security (`PASS`)
- **Completed:**
  - Enabled `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false` in `applications/electron/main/bootstrap.js`.
  - Replaced `applications/electron/preload.mjs` (`node:net` access) with sandbox-compatible `applications/electron/preload/preload.cjs` exposing only `isElectron`, `platform.{getInfo,openExternal}`, and `network.{registerServers,open,send,close,onEvent}`.
  - Implemented `applications/electron/main/ipc-security.js` (`senderFrame === mainFrame`, origin checks, payload/URL/port/socketId/binary validation) and `applications/electron/main/ipc-handlers.js`.
  - Implemented `applications/electron/main/window-security.js` locking `will-navigate`, `setWindowOpenHandler` (validated `http:`/`https:` via `shell.openExternal`), session permissions (`false`), `will-download` prevention, and socket cleanup on navigation/crash/destroy.
  - Verified with `tests/desktop/ipc-security.test.js` (5 tests) and live packaged Electron CDP sandbox probe (`hasRequire: false`, `hasProcess: false`, blocked metadata IP/unconfigured server/file URI, zero console errors).
- **Files Added/Modified/Removed:**
  - `applications/electron/preload/preload.cjs` (added), `applications/electron/preload.mjs` (removed)
  - `applications/electron/main/ipc-security.js`, `applications/electron/main/ipc-handlers.js`, `applications/electron/main/window-security.js`, `applications/electron/main/bootstrap.js`
  - `applications/electron/electron-builder.yml`, `eslint.config.js`
  - `tests/desktop/ipc-security.test.js`

### `G1` — Build & Renderer of Electron (`PASS`)
- **Completed:**
  - Created Vite desktop renderer build pipeline (`applications/electron/vite.desktop.config.mjs`) producing deterministic bundles in `dist/DesktopRenderer/` (including Web Workers `ThreadEventHandler`, `PathFindingWorker`, `liblua5.1.wasm` asset, `?raw` templates/shaders, dynamic app chunks, icons, and `rijndael-js`/`bson`/`lodash-es`/`jquery`).
  - Migrated desktop HTML entry (`applications/electron/renderer/index.html`, `preloader.css`, `config.js`, `entry.js`) removing inline scripts, removing hardcoded public servers/`remoteClient`/`socketProxy`/`webserverAddress`, and omitting `applications/electron/index.html`.
  - Implemented strict `app://robrowser/` protocol handler (`applications/electron/main/protocol.js`, `protocol-security.js`, `csp.js`) with privileged scheme registration before `app.ready`, streaming `fs.createReadStream` + HTTP Range support, symlink `realpath` containment, traversal/UNC/backslash/drive-letter/null-byte blocking, GET/HEAD-only enforcement, and CSP without `'unsafe-eval'` (`'wasm-unsafe-eval'` enabled).
  - Updated `src/UI/Components/Intro/Intro.js` to skip external Google Fonts injection in Electron so desktop boots cleanly offline under CSP.
  - Updated `applications/electron/electron-builder.yml` to package compiled `renderer/` without raw `src/` or unused `node_modules/`.
  - Added npm scripts (`build:desktop:renderer`, `desktop:dev`, `desktop:pack`, `desktop:dist:win`, `desktop:dist:linux`, `desktop:dist:mac`) and chained `build:desktop:renderer` before `electron:build*`.
  - Verified with unit tests (`tests/desktop/protocol-security.test.js`, 9/9 PASS), ESLint (0 errors on touched/Electron files), Prettier (`format:check` PASS), Web build regression (`npm run build:all` PASS), and real CDP smoke launch from an isolated directory with spaces and Unicode (`roBrowser G1 测试\roBrowserLegacy.exe`) showing Intro UI + WebGL2 + Web Worker + blocked inline script CSP + zero console errors/exceptions.
- **Files Added/Modified:**
  - `applications/electron/main.js`, `applications/electron/main/bootstrap.js`, `applications/electron/main/protocol.js`, `applications/electron/main/protocol-security.js`, `applications/electron/main/csp.js`
  - `applications/electron/renderer/index.html`, `applications/electron/renderer/preloader.css`, `applications/electron/renderer/config.js`, `applications/electron/renderer/entry.js`
  - `applications/electron/vite.desktop.config.mjs`, `applications/electron/electron-builder.yml`
  - `applications/electron/index.html` (removed)
  - `src/UI/Components/Intro/Intro.js`, `package.json`, `eslint.config.js`
  - `tests/desktop/protocol-security.test.js`

### `G0` — Audit & Executable Baseline (`PASS`)
- **Completed:**
  - Created working branch `feat/electron-desktop-port` preserving `doc/MASTERPROMPT_ROBROWSER_ELECTRON_WEB_DESKTOP.md`.
  - Installed dependencies (`npm install --no-audit --no-fund`, 437 packages).
  - Ran full baseline checks: `npm test` (33 files / 196 tests PASS), `npm run format:check` (PASS), `npm run build:all` (PASS), `npm run lint` (PRE-EXISTING FAIL: 5 errors, 10 warnings), `npm run electron:build:win` (unpacked `dir` only, no installer).
  - Executed real CDP smoke probe against packaged `dist/Desktop/win-unpacked/roBrowserLegacy.exe`: discovered that baseline Electron app fails to boot (`TypeError: Failed to resolve module specifier "rijndael-js"`), proving `G1` deterministic bundling is critical.
  - Mapped dependency graph, Login->Char->Map server transitions, GRF/DATA.INI precedence, Encoding rules (`doc/Encoding.md`), Web Workers (`ThreadEventHandler.js`, `PathFindingWorker.js`), WASM (`liblua5.1.wasm?url`), and external HTTP endpoints.
  - Documented full baseline in `docs/desktop/BASELINE.md`.
- **Files Created:**
  - `docs/desktop/BASELINE.md`
  - `docs/desktop/PROGRESS.md`

## Upcoming Gates

1. **`G1` — Build & Renderer of Electron:** Deterministic Vite desktop renderer build (supporting `?raw`, `?url` WASM, workers, dynamic app imports, shaders, assets), secure `app://` protocol in main process (no regex rewriting, no raw `src/`, traversal/symlink/method checks, CSP without `unsafe-eval`), scripts `build:desktop:renderer`, `desktop:dev`, etc.
2. **`G2` — Electron Bridge & Security:** Move `node:net` out of preload into main process, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false` (paired with G4 VFS bridge or staged cleanly), strict `contextBridge` API with `senderFrame`/origin validation, window navigation/open/permission lock, safe cleanup on destroy/reload.
3. **`G3` — Native TCP with Packet Parity:** Main-process TCP socket manager + destination policy (explicitly configured server + authorized login->char->map redirects), byte-stream framing preservation, backpressure/queue limits, error codes, `NodeSocket.js` adapter preserving contract, comprehensive socket/TCP loopback tests.
4. **`G4` — Local Assets, GRF, VFS & Workers:** `AssetProvider` platform boundary, benchmark Option A (Node worker/utilityProcess GRF service with fd slice reads & persistent index) vs Option B (protocol Range/byte bridge to Web Worker), `DATA.INI` + multiple GRF + loose `data/`/`BGM/`/`System/`/`AI/` precedence, encoding preservation, path traversal protection, Web/Desktop byte-parity tests.
5. **`G5` — Configuration, Persistence & First-Use UX:** Desktop launcher/settings panel (folder/GRF selection, indexing progress, missing/conflict repair, server schema validation, graphics/audio/preferences store without plaintext passwords, structured diagnostics export).
6. **`G6` — OS Integration & Stability:** Window state persistence with display bounds validation, DPI/fullscreen/resolution sync, single-instance lock, clean quit/handle release, WebGL failure fallback UI, input/focus/audio checks.
7. **`G7` — Launcher, Patcher & Safe Updater:** Signed/hashed asset manifest verifier, atomic temp->verify->swap with rollback, path confinement, managed vs user GRF separation, local test patch server + `electron-updater` feed architecture & tests.
8. **`G8` — Packaging & Distribution:** `electron-builder` NSIS Windows x64 installer, `asar: true`, no raw `src/` or dev `node_modules`, Linux/macOS target config, GitHub Actions CI desktop build/test workflow, isolated release smoke test.
9. **`G9` — Parity Matrix, Performance & Docs:** Full Web vs Desktop parity matrix, `PerfProbe` / startup / RSS / FD / IPC latency benchmarks, complete `docs/desktop/*.md` suite, final audit.

## Active Risks / Blockers

- **Pre-existing ESLint failures** in `src/Renderer/Entity/EntityWalk.js` and `src/UI/Components/GrfViewer/GrfViewer.js` — will not touch unrelated game code unless needed; will ensure all new/modified files pass ESLint cleanly (`npx eslint ...`) and Prettier (`npm run format:check`).
- **External Ragnarok Server / Commercial GRFs:** Not present in repo (per policy). Live login/char/map E2E will be tested against synthetic local TCP/GRF test harnesses unless a local test server is configured; real external server/commercial GRF login will be explicitly marked `BLOCKED` if unavailable.
- **Code Signing Certificates & macOS/Linux Hardware:** Only Windows x64 host is available locally; Linux/macOS targets and OS code-signing/notarization will be configured in CI/builder and marked appropriately where unexecuted locally.
