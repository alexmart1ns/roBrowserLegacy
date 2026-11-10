import { app, BrowserWindow, Menu, screen, session } from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { getAppEntryUrl, registerAppProtocol, registerPrivilegedSchemes, resolveRendererRoot } from './protocol.js';
import { registerAssetProtocol, registerAssetScheme } from './asset-protocol.js';
import { applySessionSecurity, applyWindowSecurity } from './window-security.js';
import { createDesktopServices, extractAllowedConnectOrigins } from './ipc-handlers.js';
import { clampWindowBoundsToDisplays } from './window-state.js';
import { SettingsStore } from '../services/settings-store.js';
import { DesktopLogger } from '../services/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronDir = path.resolve(__dirname, '..');

const isDev = !app.isPackaged && process.argv.includes('--dev');
const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000/applications/electron/renderer/index.html';
const devOrigin = (() => {
	try {
		return new URL(devUrl).origin;
	} catch {
		return 'http://localhost:3000';
	}
})();

function getCliFlagValue(prefix) {
	const found = process.argv.find(arg => arg.startsWith(prefix));
	return found ? found.slice(prefix.length) : null;
}

registerPrivilegedSchemes();
registerAssetScheme();

let mainWindow = null;
let desktopServices = null;

function attachWindowBoundsPersistence(win, settingsStore) {
	let timer = null;

	const saveCurrentBounds = () => {
		if (!win || win.isDestroyed()) {
			return;
		}
		const current = settingsStore.get();
		const isMax = win.isMaximized();
		const isFull = win.isFullScreen();
		const nextBounds = {
			...current.windowBounds,
			maximized: isMax
		};
		if (!isMax && !isFull) {
			const b = win.getBounds();
			nextBounds.width = Math.max(800, b.width);
			nextBounds.height = Math.max(600, b.height);
			nextBounds.x = b.x;
			nextBounds.y = b.y;
		}
		settingsStore.save({ windowBounds: nextBounds });
	};

	const scheduleSave = () => {
		clearTimeout(timer);
		timer = setTimeout(saveCurrentBounds, 250);
	};

	win.on('resize', scheduleSave);
	win.on('move', scheduleSave);
	win.on('maximize', scheduleSave);
	win.on('unmaximize', scheduleSave);
	win.on('close', () => {
		clearTimeout(timer);
		saveCurrentBounds();
	});
}

function createWindow({ settingsStore }) {
	const settings = settingsStore.get();
	const bounds = clampWindowBoundsToDisplays(
		settings.windowBounds,
		screen.getAllDisplays(),
		screen.getPrimaryDisplay()
	);

	// Prevent Windows/Linux menu bar from intercepting Ragnarok Alt+* hotkeys
	if (process.platform !== 'darwin') {
		Menu.setApplicationMenu(null);
	}

	mainWindow = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		minWidth: 800,
		minHeight: 600,
		fullscreen: Boolean(settings.preferences?.fullscreen),
		autoHideMenuBar: true,
		frame: true,
		icon: path.join(electronDir, 'icon.png'),
		webPreferences: {
			preload: path.join(electronDir, 'preload', 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInWorker: false,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false
		}
	});

	if (bounds.maximized && !settings.preferences?.fullscreen) {
		mainWindow.maximize();
	}

	attachWindowBoundsPersistence(mainWindow, settingsStore);

	applyWindowSecurity(mainWindow, {
		isDev,
		devOrigin,
		onCleanup(webContentsId) {
			if (desktopServices) {
				desktopServices.cleanupOwner(webContentsId);
			}
		}
	});

	if (desktopServices) {
		mainWindow.webContents.on('did-finish-load', () => {
			if (!mainWindow || mainWindow.isDestroyed()) {
				return;
			}
			const current = settingsStore.get();
			desktopServices.networkPolicy.setConfiguredServers(mainWindow.webContents.id, current.servers);
		});
	}

	if (isDev) {
		process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
		mainWindow.loadURL(devUrl);
		mainWindow.webContents.openDevTools();
	} else {
		mainWindow.loadURL(getAppEntryUrl());
	}

	mainWindow.on('closed', () => {
		mainWindow = null;
	});

	return mainWindow;
}

export async function startApp() {
	const allowMultiple = process.argv.includes('--allow-multiple-instances');
	if (!allowMultiple) {
		const gotLock = app.requestSingleInstanceLock();
		if (!gotLock) {
			app.quit();
			return;
		}
		app.on('second-instance', () => {
			if (!mainWindow || mainWindow.isDestroyed()) {
				return;
			}
			if (mainWindow.isMinimized()) {
				mainWindow.restore();
			}
			if (!mainWindow.isVisible()) {
				mainWindow.show();
			}
			mainWindow.focus();
		});
	}

	await app.whenReady();

	const userDataDir = app.getPath('userData');
	const settingsStore = new SettingsStore(path.join(userDataDir, 'desktop-settings.json'));
	const initialSettings = settingsStore.load();
	const logger = new DesktopLogger({
		logDir: path.join(userDataDir, 'logs'),
		debugEnabled: Boolean(initialSettings.debugLogging)
	});

	applySessionSecurity(session.defaultSession);
	desktopServices = createDesktopServices({
		isDev,
		devOrigin,
		settingsStore,
		logger
	});
	registerAssetProtocol({ assetService: desktopServices.assetService, isDev, devOrigin });

	const initialAssetsDir =
		getCliFlagValue('--assets-dir=') || process.env.RO_ASSETS_DIR || initialSettings.assets?.directory || null;
	if (initialAssetsDir) {
		await desktopServices.assetService
			.initializeDirectory(initialAssetsDir, {
				grfList: initialSettings.assets?.grfList || null
			})
			.catch(err => {
				logger.warn('assets', 'Failed to initialize initial assets directory', {
					message: err?.message || 'unknown'
				});
			});
	}

	if (!isDev) {
		const rendererRoot = resolveRendererRoot(electronDir);
		if (!fs.existsSync(path.join(rendererRoot, 'index.html'))) {
			throw new Error(
				`Desktop renderer bundle not found at "${rendererRoot}". Run "npm run build:desktop:renderer" first.`
			);
		}
		await registerAppProtocol({
			rendererRoot,
			getAllowedConnectOrigins: () => extractAllowedConnectOrigins(settingsStore.get())
		});
	}

	createWindow({ settingsStore });

	let isQuitting = false;
	app.on('before-quit', event => {
		if (isQuitting || !desktopServices) {
			return;
		}
		event.preventDefault();
		isQuitting = true;
		desktopServices
			.shutdown()
			.catch(() => {})
			.finally(() => app.quit());
	});

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit();
		}
	});

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow({ settingsStore });
		}
	});
}
