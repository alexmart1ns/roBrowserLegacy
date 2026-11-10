# Desktop Port Progress (`docs/desktop/PROGRESS.md`)

## Current Status

- **Current Phase / Gate:** `G0` completed -> Moving to `G1` (Desktop Renderer Bundle & Safe `app://` Protocol)
- **Branch:** `feat/electron-desktop-port`
- **Base Commit:** `337870b6eea50ec0f528f02116c36082f608967a`
- **Environment:** Windows 11 x64 (`10.0.26300.0`), Node `v24.15.0`, npm `11.12.1`, Electron `41.10.7`, Vite `8.3.7`, Vitest `4.1.12`, electron-builder `26.18.0`

## Completed Gates

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
