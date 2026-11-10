import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	SETTINGS_SCHEMA_VERSION,
	SettingsStore,
	createDefaultSettings,
	validateServerEntry
} from '../../applications/electron/services/settings-store.js';
import { DesktopLogger, sanitizeValue } from '../../applications/electron/services/logger.js';
import { clampWindowBoundsToDisplays } from '../../applications/electron/main/window-state.js';
import {
	MAX_SCREENSHOT_BYTES,
	toTightUint8Array,
	validateLogPayload,
	validateWindowSizePayload
} from '../../applications/electron/main/ipc-security.js';
import {
	buildDesktopROConfig,
	syncRendererPreferencesToLocalStorage
} from '../../applications/electron/renderer/config.js';

const tempDirs = [];
function makeTempDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro-g5g6-test-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
	}
});

describe('SettingsStore & Validation (G5)', () => {
	it('creates clean default settings with no hardcoded private servers or credentials', () => {
		const defaults = createDefaultSettings();
		expect(defaults.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
		expect(defaults.servers).toEqual([]);
		expect(defaults.assets.directory).toBeNull();
		expect(defaults.debugLogging).toBe(false);
	});

	it('persists normalized settings atomically and reloads cleanly', () => {
		const dir = makeTempDir();
		const settingsPath = path.join(dir, 'nested', 'desktop-settings.json');
		const store = new SettingsStore(settingsPath);
		store.load();

		const saved = store.save({
			assets: { directory: 'C:\\RO\\Client' },
			servers: [
				{
					id: 's1',
					display: 'Local Test',
					address: '127.0.0.1',
					port: 6900,
					packetver: '20220406',
					webserverAddress: 'https://panel.example.org/',
					remoteClient: 'javascript:alert(1)'
				}
			],
			activeServerId: 's1',
			preferences: { screensize: '1280x800', fpslimit: 120, bgmVolume: 0.25 }
		});

		expect(saved.servers).toHaveLength(1);
		expect(saved.servers[0].webserverAddress).toBe('https://panel.example.org');
		expect(saved.servers[0].remoteClient).toBe('');
		expect(saved.servers[0].packetver).toBe(20220406);
		expect(saved.preferences.screensize).toBe('1280x800');
		expect(saved.preferences.fpslimit).toBe(120);

		const reloaded = new SettingsStore(settingsPath).load();
		expect(reloaded.assets.directory).toBe('C:\\RO\\Client');
		expect(reloaded.servers[0].address).toBe('127.0.0.1');
	});

	it('recovers cleanly from corrupt settings JSON without crashing', () => {
		const dir = makeTempDir();
		const settingsPath = path.join(dir, 'desktop-settings.json');
		fs.writeFileSync(settingsPath, '{corrupted json!!', 'utf8');

		const loaded = new SettingsStore(settingsPath).load();
		expect(loaded.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
		expect(loaded.servers).toEqual([]);
	});

	it('rejects malformed server definitions', () => {
		expect(validateServerEntry({ address: 'bad host', port: 6900 })).toBeNull();
		expect(validateServerEntry({ address: '127.0.0.1', port: 0 })).toBeNull();
		expect(validateServerEntry({ address: '127.0.0.1', port: 70000 })).toBeNull();
		expect(validateServerEntry(null)).toBeNull();
	});

	it('resets settings back to clean defaults on disk', () => {
		const dir = makeTempDir();
		const settingsPath = path.join(dir, 'desktop-settings.json');
		const store = new SettingsStore(settingsPath);
		store.save({ servers: [{ display: 'S1', address: '127.0.0.1', port: 6900 }], debugLogging: true });
		const resetData = store.reset();
		expect(resetData.servers).toEqual([]);
		expect(resetData.debugLogging).toBe(false);
		expect(new SettingsStore(settingsPath).load().servers).toEqual([]);
	});
});

describe('DesktopLogger & Diagnostics Redaction (G5/G6)', () => {
	it('redacts sensitive credentials recursively before storing logs or diagnostics', () => {
		const sanitized = sanitizeValue({
			user: 'player1',
			password: 'super-secret-password',
			nested: {
				sessionToken: 'ok-key',
				token: 'secret-jwt',
				auth: 'bearer-abc',
				cookie: 'sid=123',
				serverHost: '127.0.0.1'
			}
		});

		expect(sanitized.user).toBe('player1');
		expect(sanitized.password).toBe('[REDACTED]');
		expect(sanitized.nested.token).toBe('[REDACTED]');
		expect(sanitized.nested.auth).toBe('[REDACTED]');
		expect(sanitized.nested.cookie).toBe('[REDACTED]');
		expect(sanitized.nested.serverHost).toBe('127.0.0.1');
	});

	it('writes log file only when debugEnabled is true and keeps redacted metadata', () => {
		const logDir = path.join(makeTempDir(), 'logs');
		const logger = new DesktopLogger({ logDir, debugEnabled: false });

		logger.info('net', 'Connected', { password: 'leak', host: '127.0.0.1' });
		logger.debug('net', 'Debug suppressed');
		expect(logger.getEntries()).toHaveLength(1);
		expect(fs.existsSync(path.join(logDir, 'desktop.log'))).toBe(false);

		logger.setDebugEnabled(true);
		logger.debug('net', 'Debug active', { token: 'abc' });
		expect(logger.getEntries()).toHaveLength(2);
		const fileContent = fs.readFileSync(path.join(logDir, 'desktop.log'), 'utf8');
		expect(fileContent).toContain('[REDACTED]');
		expect(fileContent).not.toContain('abc');
	});
});

describe('Window Bounds & IPC Validation (G6)', () => {
	const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
	const secondary = { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };

	it('preserves saved position when visible on a connected display', () => {
		const bounds = clampWindowBoundsToDisplays(
			{ x: 2000, y: 100, width: 1280, height: 720, maximized: false },
			[primary, secondary],
			primary
		);
		expect(bounds).toEqual({ x: 2000, y: 100, width: 1280, height: 720, maximized: false });
	});

	it('recenters onto primary display when saved display is disconnected or off-screen', () => {
		const bounds = clampWindowBoundsToDisplays(
			{ x: 2500, y: 100, width: 1024, height: 768, maximized: false },
			[primary],
			primary
		);
		expect(bounds.x).toBe(448);
		expect(bounds.y).toBe(136);
		expect(bounds.width).toBe(1024);
		expect(bounds.height).toBe(768);
	});

	it('clamps oversized window dimensions to primary workArea', () => {
		const bounds = clampWindowBoundsToDisplays(
			{ x: 0, y: 0, width: 3840, height: 2160, maximized: true },
			[primary],
			primary
		);
		expect(bounds.width).toBe(1920);
		expect(bounds.height).toBe(1040);
		expect(bounds.maximized).toBe(true);
	});

	it('validates window size and screenshot IPC payloads', () => {
		expect(validateWindowSizePayload({ width: 1280, height: 800 })).toEqual({
			ok: true,
			width: 1280,
			height: 800
		});
		expect(validateWindowSizePayload({ width: 320, height: 240 }).ok).toBe(false);
		expect(validateLogPayload({ level: 'error', category: 'startup', message: 'fail' }).ok).toBe(true);

		const bigPng = new Uint8Array(2 * 1024 * 1024);
		expect(toTightUint8Array(bigPng).ok).toBe(false); // 1 MiB network cap
		expect(toTightUint8Array(bigPng, MAX_SCREENSHOT_BYTES).ok).toBe(true);
	});
});

describe('Renderer Preference Sync & ROConfig Builder (G5)', () => {
	it('syncs Launcher Audio and Graphics settings to localStorage while preserving advanced fields', () => {
		const memStorage = new Map([
			['Graphics', JSON.stringify({ _version: 1.1, screensize: '800x600', bloom: true, damageSkin: 3 })]
		]);
		const fakeStorage = {
			getItem: k => memStorage.get(k) ?? null,
			setItem: (k, v) => memStorage.set(k, v)
		};

		syncRendererPreferencesToLocalStorage(
			{
				preferences: {
					screensize: '1280x800',
					fullscreen: false,
					quality: 85,
					bgmVolume: 0.7,
					bgmEnabled: false,
					soundVolume: 0.9,
					soundEnabled: true,
					fpslimit: 120,
					showCursor: false
				}
			},
			fakeStorage
		);

		const graphics = JSON.parse(fakeStorage.getItem('Graphics'));
		expect(graphics.screensize).toBe('1280x800');
		expect(graphics.quality).toBe(85);
		expect(graphics.fpslimit).toBe(120);
		expect(graphics.cursor).toBe(false);
		expect(graphics.bloom).toBe(true);
		expect(graphics.damageSkin).toBe(3);

		const audio = JSON.parse(fakeStorage.getItem('Audio'));
		expect(audio.BGM).toEqual({ play: false, volume: 0.7 });
		expect(audio.Sound).toEqual({ play: true, volume: 0.9 });
	});

	it('builds ROConfig with active server and skipIntro when assets and server are ready', () => {
		const cfgReady = buildDesktopROConfig({
			settings: {
				activeServerId: 's2',
				servers: [
					{ id: 's1', display: 'One', address: '127.0.0.1', port: 6900 },
					{ id: 's2', display: 'Two', address: '127.0.0.2', port: 6901, packetver: 20200401 }
				],
				launcher: { skipIntroWhenReady: true },
				preferences: { quality: 90 }
			},
			assetsStatus: { configured: true, totalGrfEntries: 120, looseCount: 3, detectedPacketVer: 20220406 }
		});

		expect(cfgReady.servers).toHaveLength(1);
		expect(cfgReady.servers[0].display).toBe('Two');
		expect(cfgReady.skipIntro).toBe(true);
		expect(cfgReady.packetver).toBe(20200401);
		expect(cfgReady.quality).toBe(90);

		const cfgNoServer = buildDesktopROConfig({
			settings: { servers: [], launcher: { skipIntroWhenReady: true }, preferences: {} },
			assetsStatus: { configured: true, totalGrfEntries: 10 }
		});
		expect(cfgNoServer.skipIntro).toBe(false);
	});
});
