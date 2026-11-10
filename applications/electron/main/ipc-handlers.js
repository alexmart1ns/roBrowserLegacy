import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
	MAX_SCREENSHOT_BYTES,
	assertValidIpcSender,
	toTightUint8Array,
	validateExternalUrl,
	validateLogPayload,
	validateOpenSocketPayload,
	validateSocketId,
	validateWindowSizePayload
} from './ipc-security.js';
import { NetworkDestinationPolicy } from '../services/network-policy.js';
import { TcpService } from '../services/tcp-service.js';
import { AssetService } from '../services/asset-service.js';
import { SettingsStore } from '../services/settings-store.js';
import { DesktopLogger } from '../services/logger.js';
import { ManifestPatcher } from '../services/manifest-patcher.js';
import { AppUpdaterService } from '../services/app-updater.js';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasPngSignature(bytes) {
	if (!bytes || bytes.byteLength < PNG_MAGIC.length) {
		return false;
	}
	for (let i = 0; i < PNG_MAGIC.length; i++) {
		if (bytes[i] !== PNG_MAGIC[i]) {
			return false;
		}
	}
	return true;
}

export async function buildDiagnosticsSnapshot({ settingsStore, assetService, logger }) {
	const assetsStatus = assetService ? await assetService.getStatus().catch(() => null) : null;
	return {
		exportedAt: new Date().toISOString(),
		platform: {
			os: process.platform,
			arch: process.arch,
			appVersion: app.getVersion(),
			electronVersion: process.versions.electron,
			chromeVersion: process.versions.chrome,
			nodeVersion: process.versions.node,
			isPackaged: app.isPackaged
		},
		settings: settingsStore ? settingsStore.getSanitizedForDiagnostics() : null,
		assetsStatus,
		logs: logger ? logger.getEntries() : []
	};
}

export function extractAllowedConnectOrigins(settings) {
	const origins = new Set();
	if (!settings || typeof settings !== 'object') {
		return [];
	}

	const candidates = [];
	if (Array.isArray(settings.servers)) {
		for (const srv of settings.servers) {
			if (srv?.webserverAddress) {
				candidates.push(srv.webserverAddress);
			}
			if (srv?.remoteClient) {
				candidates.push(srv.remoteClient);
			}
		}
	}
	if (settings.updates?.appFeedUrl) {
		candidates.push(settings.updates.appFeedUrl);
	}
	if (settings.updates?.assetManifestUrl) {
		candidates.push(settings.updates.assetManifestUrl);
	}

	for (const raw of candidates) {
		try {
			const parsed = new URL(raw);
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
				origins.add(parsed.origin);
			}
		} catch {
			// Ignore malformed optional URLs
		}
	}

	return [...origins];
}

export function createDesktopServices({
	isDev = false,
	devOrigin = 'http://localhost:3000',
	cacheDir = null,
	managedAssetsDir = null,
	settingsStore = null,
	logger = null
} = {}) {
	const store = settingsStore || new SettingsStore(path.join(app.getPath('userData'), 'desktop-settings.json'));
	if (!settingsStore) {
		store.load();
	}

	const logService =
		logger ||
		new DesktopLogger({
			logDir: path.join(app.getPath('userData'), 'logs'),
			debugEnabled: Boolean(store.get().debugLogging)
		});

	const networkPolicy = new NetworkDestinationPolicy();

	const broadcastToWindows = (channel, payload) => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
				win.webContents.send(channel, payload);
			}
		}
	};

	const emitNetworkEvent = (ownerId, payload) => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed() && win.webContents && win.webContents.id === ownerId) {
				if (!win.webContents.isDestroyed()) {
					win.webContents.send('ro:net:event', payload);
				}
				return;
			}
		}
	};

	const tcpService = new TcpService({
		policy: networkPolicy,
		emitEvent: emitNetworkEvent
	});

	const resolvedManagedDir = managedAssetsDir || path.join(app.getPath('userData'), 'managed-assets');

	const assetService = new AssetService({
		cacheDir: cacheDir || path.join(app.getPath('userData'), 'cache', 'grf-index'),
		managedDir: resolvedManagedDir,
		onProgress: progress => broadcastToWindows('ro:assets:progress', progress)
	});

	const manifestPatcher = new ManifestPatcher({
		managedDir: resolvedManagedDir,
		beforeApply: () => assetService.close(),
		afterApply: () => assetService.reindex(),
		onProgress: progress => broadcastToWindows('ro:updates:patchProgress', progress)
	});

	const appUpdater = new AppUpdaterService({
		currentVersion: app.getVersion(),
		updatesDir: path.join(app.getPath('userData'), 'pending-updates'),
		onStatus: status => broadcastToWindows('ro:updates:appStatus', status)
	});

	const senderOpts = { isDev, devOrigin };

	ipcMain.handle('ro:platform:getInfo', event => {
		assertValidIpcSender(event, senderOpts);
		return {
			platform: process.platform,
			arch: process.arch,
			appVersion: app.getVersion(),
			isPackaged: app.isPackaged,
			electronVersion: process.versions.electron,
			chromeVersion: process.versions.chrome,
			allowedConnectOrigins: extractAllowedConnectOrigins(store.get())
		};
	});

	ipcMain.handle('ro:platform:openExternal', async (event, rawUrl) => {
		assertValidIpcSender(event, senderOpts);
		const check = validateExternalUrl(rawUrl);
		if (!check.ok) {
			return { ok: false, code: check.reason };
		}
		await shell.openExternal(check.url);
		return { ok: true };
	});

	ipcMain.handle('ro:platform:saveScreenshot', async (event, rawBytes) => {
		assertValidIpcSender(event, senderOpts);
		const binary = toTightUint8Array(rawBytes, MAX_SCREENSHOT_BYTES);
		if (!binary.ok) {
			return { ok: false, code: binary.reason };
		}
		if (!hasPngSignature(binary.bytes)) {
			return { ok: false, code: 'INVALID_PNG_SIGNATURE' };
		}

		try {
			const screenshotsDir = path.join(app.getPath('pictures'), 'roBrowserLegacy');
			await fs.promises.mkdir(screenshotsDir, { recursive: true });
			const stamp = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `roBrowser-${stamp}-${process.pid}.png`;
			const targetPath = path.join(screenshotsDir, fileName);
			await fs.promises.writeFile(targetPath, binary.bytes, { flag: 'wx' });
			logService.info('screenshot', 'Saved desktop screenshot', { fileName });
			return { ok: true, filePath: targetPath, fileName };
		} catch (err) {
			logService.error('screenshot', 'Failed to save screenshot', { message: err?.message || 'unknown' });
			return { ok: false, code: 'SCREENSHOT_WRITE_FAILED' };
		}
	});

	ipcMain.handle('ro:settings:load', event => {
		const ownerId = assertValidIpcSender(event, senderOpts);
		const current = store.get();
		networkPolicy.setConfiguredServers(ownerId, current.servers);
		return current;
	});

	ipcMain.handle('ro:settings:save', (event, partial) => {
		const ownerId = assertValidIpcSender(event, senderOpts);
		const saved = store.save(partial);
		logService.setDebugEnabled(Boolean(saved.debugLogging));
		networkPolicy.setConfiguredServers(ownerId, saved.servers);
		logService.info('settings', 'Saved desktop settings', {
			serversCount: saved.servers.length,
			hasAssetsDir: Boolean(saved.assets?.directory)
		});
		return saved;
	});

	ipcMain.handle('ro:settings:reset', event => {
		const ownerId = assertValidIpcSender(event, senderOpts);
		const resetData = store.reset();
		logService.setDebugEnabled(false);
		networkPolicy.setConfiguredServers(ownerId, resetData.servers);
		logService.info('settings', 'Reset desktop settings to defaults');
		return resetData;
	});

	ipcMain.handle('ro:diagnostics:log', (event, rawPayload) => {
		assertValidIpcSender(event, senderOpts);
		const check = validateLogPayload(rawPayload);
		if (!check.ok) {
			return { ok: false, code: check.reason };
		}
		logService.log(check.level, check.category, check.message, check.meta);
		return { ok: true };
	});

	ipcMain.handle('ro:diagnostics:getSnapshot', async event => {
		assertValidIpcSender(event, senderOpts);
		return buildDiagnosticsSnapshot({
			settingsStore: store,
			assetService,
			logger: logService
		});
	});

	ipcMain.handle('ro:diagnostics:export', async event => {
		assertValidIpcSender(event, senderOpts);
		const win = BrowserWindow.fromWebContents(event.sender);
		const snapshot = await buildDiagnosticsSnapshot({
			settingsStore: store,
			assetService,
			logger: logService
		});
		const defaultName = `roBrowserLegacy-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
		const saved = await dialog.showSaveDialog(win || undefined, {
			title: 'Export Diagnostics Report',
			defaultPath: path.join(app.getPath('documents'), defaultName),
			filters: [{ name: 'JSON', extensions: ['json'] }]
		});
		if (saved.canceled || !saved.filePath) {
			return { ok: true, canceled: true };
		}
		await fs.promises.writeFile(saved.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
		logService.info('diagnostics', 'Exported diagnostics report', { filePath: saved.filePath });
		return { ok: true, canceled: false, filePath: saved.filePath };
	});

	ipcMain.handle('ro:window:setFullscreen', (event, fullscreen) => {
		assertValidIpcSender(event, senderOpts);
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win || win.isDestroyed()) {
			return { ok: false, code: 'WINDOW_NOT_FOUND' };
		}
		const target = Boolean(fullscreen);
		if (win.isFullScreen() !== target) {
			win.setFullScreen(target);
		}
		return {
			ok: true,
			fullscreen: win.isFullScreen(),
			maximized: win.isMaximized(),
			bounds: win.getBounds()
		};
	});

	ipcMain.handle('ro:window:setSize', (event, rawPayload) => {
		assertValidIpcSender(event, senderOpts);
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win || win.isDestroyed()) {
			return { ok: false, code: 'WINDOW_NOT_FOUND' };
		}
		const check = validateWindowSizePayload(rawPayload);
		if (!check.ok) {
			return { ok: false, code: check.reason };
		}
		if (win.isFullScreen()) {
			win.setFullScreen(false);
		}
		if (win.isMaximized()) {
			win.unmaximize();
		}
		const display = screen.getDisplayMatching(win.getBounds());
		const wa = display?.workArea || { width: 1920, height: 1080 };
		const targetW = Math.min(check.width, Math.max(800, wa.width));
		const targetH = Math.min(check.height, Math.max(600, wa.height));
		win.setContentSize(targetW, targetH);
		win.center();
		return {
			ok: true,
			fullscreen: win.isFullScreen(),
			maximized: win.isMaximized(),
			bounds: win.getBounds(),
			contentBounds: win.getContentBounds()
		};
	});

	ipcMain.handle('ro:window:getState', event => {
		assertValidIpcSender(event, senderOpts);
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win || win.isDestroyed()) {
			return { ok: false, code: 'WINDOW_NOT_FOUND' };
		}
		return {
			ok: true,
			fullscreen: win.isFullScreen(),
			maximized: win.isMaximized(),
			bounds: win.getBounds(),
			contentBounds: win.getContentBounds()
		};
	});

	ipcMain.handle('ro:assets:selectDirectory', async event => {
		assertValidIpcSender(event, senderOpts);
		const win = BrowserWindow.fromWebContents(event.sender);
		const picked = await dialog.showOpenDialog(win || undefined, {
			title: 'Select Ragnarok Online Client Directory',
			properties: ['openDirectory']
		});
		if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) {
			return { ok: true, canceled: true, status: await assetService.getStatus() };
		}
		try {
			const selectedDir = picked.filePaths[0];
			const current = store.get();
			const status = await assetService.initializeDirectory(selectedDir, {
				grfList: current.assets?.grfList || null
			});
			store.save({ assets: { directory: selectedDir } });
			logService.info('assets', 'Initialized local assets directory', {
				ready: status.ready,
				grfCount: status.grfFiles?.length || 0,
				detectedPacketVer: status.detectedPacketVer || null
			});
			return { ok: true, canceled: false, status };
		} catch (err) {
			logService.warn('assets', 'Asset initialization failed', { message: err?.message || 'ASSET_INIT_FAILED' });
			return { ok: false, canceled: false, error: err?.message || 'ASSET_INIT_FAILED' };
		}
	});

	ipcMain.handle('ro:assets:getStatus', event => {
		assertValidIpcSender(event, senderOpts);
		return assetService.getStatus();
	});

	ipcMain.handle('ro:assets:reindex', event => {
		assertValidIpcSender(event, senderOpts);
		return assetService.reindex();
	});

	ipcMain.handle('ro:assets:clearCache', async event => {
		assertValidIpcSender(event, senderOpts);
		await assetService.clearCache();
		return assetService.reindex();
	});

	ipcMain.handle('ro:net:registerServers', (event, servers) => {
		const ownerId = assertValidIpcSender(event, senderOpts);
		const count = networkPolicy.setConfiguredServers(ownerId, servers);
		return { ok: true, count };
	});

	ipcMain.handle('ro:net:open', async (event, rawPayload) => {
		const ownerId = assertValidIpcSender(event, senderOpts);
		const check = validateOpenSocketPayload(rawPayload);
		if (!check.ok) {
			logService.warn('network', 'Blocked invalid TCP open payload', { reason: check.reason });
			return { ok: false, code: check.reason, error: 'Invalid socket open payload' };
		}
		const res = await tcpService.open(ownerId, {
			host: check.host,
			port: check.port,
			role: check.role
		});
		if (!res.ok) {
			logService.warn('network', 'TCP connection rejected or failed', {
				code: res.code,
				role: check.role,
				host: check.host,
				port: check.port
			});
		}
		return res;
	});

	ipcMain.handle('ro:net:send', (event, rawSocketId, rawData) => {
		const ownerId = assertValidIpcSender(event, senderOpts);
		const socketId = validateSocketId(rawSocketId);
		if (!socketId) {
			return { ok: false, code: 'INVALID_SOCKET_ID' };
		}
		const binary = toTightUint8Array(rawData);
		if (!binary.ok) {
			return { ok: false, code: binary.reason };
		}
		return tcpService.send(ownerId, socketId, binary.bytes);
	});

	ipcMain.handle('ro:net:close', (event, rawSocketId) => {
		const ownerId = assertValidIpcSender(event, senderOpts);
		const socketId = validateSocketId(rawSocketId);
		if (!socketId) {
			return { ok: false, code: 'INVALID_SOCKET_ID' };
		}
		return tcpService.close(ownerId, socketId);
	});

	ipcMain.handle('ro:updates:getStatus', event => {
		assertValidIpcSender(event, senderOpts);
		return {
			app: appUpdater.getStatus(),
			patch: manifestPatcher.readState(),
			managedDir: manifestPatcher.getManagedDir()
		};
	});

	ipcMain.handle('ro:updates:setGameplayActive', (event, active) => {
		assertValidIpcSender(event, senderOpts);
		appUpdater.setGameplayActive(Boolean(active));
		return { ok: true, gameplayActive: appUpdater.isGameplayActive() };
	});

	ipcMain.handle('ro:updates:checkApp', async event => {
		assertValidIpcSender(event, senderOpts);
		const current = store.get();
		return appUpdater.checkForUpdates({
			feedUrl: current.updates?.appFeedUrl || '',
			channel: current.updates?.channel || 'stable'
		});
	});

	ipcMain.handle('ro:updates:downloadApp', async event => {
		assertValidIpcSender(event, senderOpts);
		return appUpdater.downloadAvailableUpdate();
	});

	ipcMain.handle('ro:updates:installApp', async event => {
		assertValidIpcSender(event, senderOpts);
		const prep = await appUpdater.prepareInstall();
		if (!prep.ok) {
			return prep;
		}
		const openErr = await shell.openPath(prep.installerPath);
		if (openErr) {
			return { ok: false, code: 'INSTALLER_LAUNCH_FAILED', error: openErr };
		}
		logService.info('updater', 'Launching verified application installer', { version: prep.version });
		setImmediate(() => app.quit());
		return { ok: true, version: prep.version };
	});

	ipcMain.handle('ro:updates:checkAssetPatch', async event => {
		assertValidIpcSender(event, senderOpts);
		const current = store.get();
		const res = await manifestPatcher.fetchAndVerifyManifest(current.updates?.assetManifestUrl || '', {
			channel: current.updates?.channel || 'stable'
		});
		if (res.ok) {
			const { rawManifest: _omitted, ...summary } = res;
			return summary;
		}
		return res;
	});

	ipcMain.handle('ro:updates:applyAssetPatch', async event => {
		assertValidIpcSender(event, senderOpts);
		const current = store.get();
		const applied = await manifestPatcher.applyFromUrl(current.updates?.assetManifestUrl || '', {
			channel: current.updates?.channel || 'stable'
		});
		const assetsStatus = await assetService.getStatus();
		return { ...applied, assetsStatus };
	});

	ipcMain.handle('ro:updates:cancelAssetPatch', event => {
		assertValidIpcSender(event, senderOpts);
		manifestPatcher.cancelActive();
		return { ok: true };
	});

	return {
		settingsStore: store,
		logger: logService,
		manifestPatcher,
		appUpdater,
		networkPolicy,
		tcpService,
		assetService,
		cleanupOwner(ownerId) {
			tcpService.destroyOwnerSockets(ownerId);
		},
		async shutdown() {
			manifestPatcher.cancelActive();
			await assetService.close();
		}
	};
}
