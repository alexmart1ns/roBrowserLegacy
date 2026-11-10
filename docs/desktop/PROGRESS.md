# Desktop Port Progress (`docs/desktop/PROGRESS.md`)

## Current Status

- **Current Phase / Gate:** `G3` completed -> Moving to `G4` (Local Assets, GRF, VFS & Workers)
- **Branch:** `feat/electron-desktop-port`
- **Base Commit:** `337870b6eea50ec0f528f02116c36082f608967a`
- **Environment:** Windows 11 x64 (`10.0.26300.0`), Node `v24.15.0`, npm `11.12.1`, Electron `41.10.7`, Vite `8.3.7`, Vitest `4.1.12`, electron-builder `26.18.0`

## Completed Gates

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
