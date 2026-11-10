import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import process from 'node:process';
import {
	assertValidIpcSender,
	toTightUint8Array,
	validateExternalUrl,
	validateOpenSocketPayload,
	validateSocketId
} from './ipc-security.js';
import { NetworkDestinationPolicy } from '../services/network-policy.js';
import { TcpService } from '../services/tcp-service.js';
import { AssetService } from '../services/asset-service.js';

export function createDesktopServices({ isDev = false, devOrigin = 'http://localhost:3000', cacheDir = null } = {}) {
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

	const assetService = new AssetService({
		cacheDir: cacheDir || path.join(app.getPath('userData'), 'cache', 'grf-index'),
		onProgress: progress => broadcastToWindows('ro:assets:progress', progress)
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
			chromeVersion: process.versions.chrome
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
			const status = await assetService.initializeDirectory(picked.filePaths[0]);
			return { ok: true, canceled: false, status };
		} catch (err) {
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
			return { ok: false, code: check.reason, error: 'Invalid socket open payload' };
		}
		return tcpService.open(ownerId, {
			host: check.host,
			port: check.port,
			role: check.role
		});
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

	return {
		networkPolicy,
		tcpService,
		assetService,
		cleanupOwner(ownerId) {
			tcpService.destroyOwnerSockets(ownerId);
		},
		async shutdown() {
			await assetService.close();
		}
	};
}
