# Desktop Port Baseline (`G0`)

Recorded before any refactoring on branch `feat/electron-desktop-port`.

## Environment Inventory

| Property | Value |
| --- | --- |
| Base Commit | `337870b6eea50ec0f528f02116c36082f608967a` (`master`) |
| Working Branch | `feat/electron-desktop-port` |
| Working Tree (pre-existing) | Untracked `doc/MASTERPROMPT_ROBROWSER_ELECTRON_WEB_DESKTOP.md` (preserved) |
| Operating System | Microsoft Windows NT `10.0.26300.0` (64-bit) |
| CPU / Architecture | AMD Ryzen 9 5900XT 16-Core Processor (`win32-x64`) |
| Node.js / npm | `v24.15.0` / `11.12.1` (`.nvmrc`: `22`, `engines.node`: `>=22`) |
| Lockfile | None (`package-lock.json` is listed in `.gitignore`) |
| Electron | `41.10.7` (`package.json`: `^41.2.0`) |
| electron-builder | `26.18.0` (`package.json`: `^26.8.1`) |
| Vite / Vitest | `8.3.7` / `4.1.12` |
| Graphical Execution | Windows Electron launches with virtual display fallback (`1920x1080`), WebGL2 active (`gl2: true`), Web Workers active, CDP inspection & screenshot capture verified |

## Baseline Command Results

| Check | Command | Exit | Status | Notes |
| --- | --- | --- | --- | --- |
| Dependencies | `npm install --no-audit --no-fund` | 0 | `PASS` | Installed 437 packages into `node_modules/` |
| ESLint | `npm run lint` | 1 | `FAIL` (`PRE-EXISTING`) | 5 errors (`EntityWalk.js:432` `no-shadow`, `GrfViewer.js` x4 `ROBrowser is not defined`), 10 warnings across 7 files |
| Prettier | `npm run format:check` | 0 | `PASS` | All matched files in `src/**/*.js` formatted |
| Unit Tests | `npm test` | 0 | `PASS` | 33 test files, 196 tests passed (`vitest run`) |
| Web Build | `npm run build:all` | 0 | `PASS` | Built all 7 apps + `ThreadEventHandler.js` + `index.html` + PWA into `dist/Web/` |
| Desktop Build (Win) | `npm run electron:build:win` | 0 | `PASS` (unpacked only) | `electron-builder.yml` only builds `target: dir` (`asar: false`) into `dist/Desktop/win-unpacked/`; no NSIS `.exe` installer |
| Packaged Desktop Boot | `dist/Desktop/win-unpacked/roBrowserLegacy.exe --remote-debugging-port=9333` | N/A | `FAIL` (`PRE-EXISTING`) | Hangs indefinitely on `#ro-preloader`: `TypeError: Failed to resolve module specifier "rijndael-js"` |

## Subsystem Baseline Table

| Component | Status | Expected Behavior | Evidence | Problem | Priority |
| --- | --- | --- | --- | --- | --- |
| Desktop Bootstrap (`applications/electron/main.js`) | `FAIL` | Deterministic bundled renderer, safe `app://` protocol, clean shutdown | CDP probe failed on `rijndael-js`; `main.js` uses regex rewrite on raw `src/` + `fs.readFileSync` | No build pipeline; no `?url` handler (breaks `liblua5.1.wasm?url`); missing `rijndael-js` in importmap & builder; regex rewrite on every request; `app.exit(0)` on close; unsafe Chromium switches | P0 |
| Security & Preload (`applications/electron/preload.mjs`) | `FAIL` | Minimal `contextBridge` API, `sandbox: true`, `nodeIntegrationInWorker: false`, validated IPC | `preload.mjs` imports `node:net`; `main.js` sets `sandbox: false`, `nodeIntegrationInWorker: true` | Exposes arbitrary `net.connect(port, host)` to renderer (SSRF/LAN scan risk); no origin/senderFrame validation; no navigation/permission lock; inline `<script>` in `index.html` blocks strict CSP | P0 |
| Desktop Packaging (`applications/electron/electron-builder.yml`) | `PARTIAL` | NSIS x64 installer + `asar` + bundled renderer without raw `src/` | `npm run electron:build:win` produced `dist/Desktop/win-unpacked` only | `target: dir`, `asar: false`, ships entire `src/**/*`, omits `rijndael-js`, no Windows installer, no Linux/macOS targets | P0 |
| Desktop Entry & Config (`applications/electron/index.html`, `src/Core/Configs.js`) | `PARTIAL` | Validated local/server config without mandatory dev endpoints | `index.html` embeds `ROConfig` with `development: true`, `remoteClient: 'https://grf.robrowser.com/'`, `socketProxy: 'ws://localhost:5999'`, `webserverAddress: 'http://127.0.0.1:8888'` | No first-run launcher/settings store; no persistent server/asset configuration; hardcoded public demo servers and localhost proxies | P1 |
| Network Transport (`src/Network/NetworkManager.js`, `NodeSocket.js`, `WebSocket.js`) | `PARTIAL` | Native TCP in Desktop (main process) and WebSocket in Browser with identical byte-stream contract | Inspected `NetworkManager.js`, `NodeSocket.js`, `LoginEngine.js`, `CharEngine.js`, `MapEngine.js` | `NodeSocket` depends on preload `node:net`; emits `onClose` after connect error; `NetworkManager` does not reset `_save_buffer` on `close()`; no destination policy or queue limits | P0 |
| Asset / GRF / VFS (`src/Core/FileManager.js`, `FileSystem.js`, `Client.js`, `Thread*.js`, `src/Loaders/GameFile.js`) | `FAIL` (under sandbox) | Local GRF + folder/DATA.INI loading via byte-slice VFS without loading full GRF in RAM or `Function('return require')()` | Inspected `FileManager.js:30`, `GameFile.js:25`, `FileSystem.js`, `ThreadEventHandler.js` | Uses `Function('return require')()` + `process.versions.electron` inside Worker (breaks when `nodeIntegrationInWorker: false`); uses `fs.readFileSync`/`existsSync` directly in worker; no persistent GRF index; no native folder selector/DATA.INI precedence service | P0 |
| Lua / WASM / AI (`src/DB/DBManager.js`, `src/Core/AIDriver.js`) | `FAIL` (packaged) | Load `liblua5.1.wasm` and execute AI/DB Lua scripts offline | `DBManager.js:3970` uses `import('Vendors/liblua5.1.wasm?url')` | Packaged `app://` handler lacks `?url` support; `AIDriver` reads AI scripts through `Client.loadFile` | P1 |
| Audio (`src/Audio/BGM.js`, `src/Audio/SoundManager.js`) | `PARTIAL` | Play local/GRF `.mp3`/`.wav`/`.ogg` without HTTP Remote Client | Inspected `BGM.js`, `SoundManager.js`, `FileManager.js:261,416` | `FileManager.getHTTP` skips arraybuffer for `.mp3`/`.wav` and passes `/client/...` URL; BGM replaces `mp3$` if URL is not `blob:`/`data:` | P1 |
| Preferences & Persistence (`src/Core/Preferences.js`, `EntityControl.js`, `PartyFriendsV1.js`, `WinLoginCommon.js`) | `PARTIAL` | Persistent per-platform settings without leaking credentials | Inspected `Preferences.js` (`localStorage`), `WinLoginCommon.js` | Uses `localStorage` tied to origin; desktop needs persistent settings store (window bounds, asset path, server config, graphics/audio) | P1 |
| Auxiliary Web Services (`Guild.js`, `ShortCut.js`, `WinLoginCommon.js`, `CashShop.js`, `Intro.js`) | `PARTIAL` | Graceful offline degradation; validated external links via `shell.openExternal` | Inspected `Guild.js:170,454`, `ShortCut.js:1174,1205`, `CashShop.js:214,221`, `Intro.js:104` | `/emblem/*` and `/userconfig/*` default to `http://127.0.0.1:8888` when `webserverAddress` missing; `window.open` unguarded; Intro injects Google Fonts stylesheet over HTTPS | P2 |
| OS Integration & Lifecycle | `NOT RUN` / `FAIL` | Clean shutdown, single-instance lock, display-safe window persistence, GPU/WebGL error UI | Inspected `main.js`, `Context.js`, `GraphicsOption.js` | `app.exit(0)` aborts cleanup; `GraphicsOption`/`Intro` resize only runs if `Context.Is.POPUP`; no GPU fallback notice | P1 |
| Launcher / Patcher / Auto-Update | `MISSING` | Signed/hashed asset manifest updater + safe app updater framework | No updater or patcher exists in `applications/electron/` | Needs manifest schema, verification, atomic swap/rollback, and configurable update feed | P1 |
| Desktop & Platform Tests | `MISSING` | Unit, integration, security, byte-parity, and E2E desktop smoke tests | `tests/` only covers `db/`, `loaders/`, `util/` | Zero tests for `NetworkManager`, `NodeSocket`, `FileManager`, Electron IPC, security, or desktop smoke | P0 |

## Dependency & Server Transition Flow (Mapped in G0)

1. **Startup Flow**: `applications/electron/index.html` -> `src/main.js` -> `App/Online.js` -> `Plugins.init()` & `GameEngine.init()` -> `Thread.init()` (`Core/ThreadEventHandler.js` module worker) & `Renderer.init()` (WebGL2) -> `loadFiles()` (`Intro` or `skipIntro` -> `Client.init` -> `DB.init()` -> `loadClientInfo()` -> `Cursor.init()`) -> `GameEngine.reload()` (`WinList` or auto-select -> `LoginEngine.init()`).
2. **Server Transitions**:
   - **Login**: `LoginEngine` connects to `server.address:server.port` via `Network.connect(host, port, cb, false)`. Receives `AC.ACCEPT_LOGIN` / `AC.ACCEPT_LOGIN3` with `ServerList` (`{ ip, port, name, ... }`).
   - **Char**: `CharEngine.init(server)` resolves `forceUseAddress ? server_info.address : Network.utils.longToIP(server.ip)` and connects to `server.port`. `Network.setPing()` closes the previous login socket.
   - **Map / Zone**: `CharEngine` receives `HC.NOTIFY_ZONESVR` / `HC.NOTIFY_ZONESVR2` -> `MapEngine.init(ip, port, mapName)` connects with `isZone = true` (enables `PacketCrypt`). Server map transfer (`ZC.NPCACK_SERVERMOVE` / `ZC.NPCACK_SERVERMOVE2`) calls `MapEngine.init(pkt.addr.ip, pkt.addr.port, pkt.mapName)` again.
   - **Disconnection**: `Network.close()` closes current socket and resets `PacketCrypt` if `isZone`. Note `_save_buffer` should also be cleared on close/connect.
3. **Asset Lookup Precedence**:
   - Priority 1: Loose local files (`FileSystem.getFile` / `data/` folder)
   - Priority 2: Loaded GRFs in `FileManager.gameFiles` order (`DATA.INI` `0=`, `1=`, `2=...` where lower index wins; or sorted smallest-to-largest when `sortBySize = true`)
   - Priority 3: Optional `remoteClient` HTTP fallback (Web default; disabled/optional on Desktop when local assets exist)
