import { app, BrowserWindow, session } from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { getAppEntryUrl, registerAppProtocol, registerPrivilegedSchemes, resolveRendererRoot } from './protocol.js';
import { applySessionSecurity, applyWindowSecurity } from './window-security.js';
import { createDesktopServices } from './ipc-handlers.js';

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

registerPrivilegedSchemes();

let mainWindow = null;
let desktopServices = null;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1024,
		height: 768,
		minWidth: 800,
		minHeight: 600,
		fullscreen: false,
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

	applyWindowSecurity(mainWindow, {
		isDev,
		devOrigin,
		onCleanup(webContentsId) {
			if (desktopServices) {
				desktopServices.cleanupOwner(webContentsId);
			}
		}
	});

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
	await app.whenReady();

	applySessionSecurity(session.defaultSession);
	desktopServices = createDesktopServices({ isDev, devOrigin });

	if (!isDev) {
		const rendererRoot = resolveRendererRoot(electronDir);
		if (!fs.existsSync(path.join(rendererRoot, 'index.html'))) {
			throw new Error(
				`Desktop renderer bundle not found at "${rendererRoot}". Run "npm run build:desktop:renderer" first.`
			);
		}
		await registerAppProtocol({ rendererRoot });
	}

	createWindow();

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit();
		}
	});

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
}
