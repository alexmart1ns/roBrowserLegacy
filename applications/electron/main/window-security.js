import { shell } from 'electron';
import { isValidRendererOrigin, validateExternalUrl } from './ipc-security.js';

export function applySessionSecurity(session) {
	session.setPermissionRequestHandler((_webContents, _permission, callback) => {
		callback(false);
	});

	session.setPermissionCheckHandler(() => false);

	session.on('will-download', event => {
		event.preventDefault();
	});
}

export function applyWindowSecurity(
	win,
	{ isDev = false, devOrigin = 'http://localhost:3000', onCleanup = null } = {}
) {
	const contents = win.webContents;
	const webContentsId = contents.id;

	contents.on('will-navigate', (event, targetUrl) => {
		if (!isValidRendererOrigin(targetUrl, { isDev, devOrigin })) {
			console.warn('[Security] Blocked navigation outside app origin:', targetUrl);
			event.preventDefault();
		}
	});

	contents.setWindowOpenHandler(({ url }) => {
		const check = validateExternalUrl(url);
		if (check.ok) {
			shell.openExternal(check.url).catch(err => {
				console.warn('[Security] Failed to open external URL:', err?.message || 'unknown error');
			});
		} else {
			console.warn(`[Security] Blocked window.open (${check.reason}):`, url);
		}
		return { action: 'deny' };
	});

	contents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
		if (isMainFrame && !_isInPlace && onCleanup) {
			onCleanup(webContentsId, 'navigation');
		}
		if (isMainFrame && !isValidRendererOrigin(url, { isDev, devOrigin })) {
			console.warn('[Security] Unexpected main-frame navigation:', url);
		}
	});

	contents.on('render-process-gone', () => {
		if (onCleanup) {
			onCleanup(webContentsId, 'render-process-gone');
		}
	});

	contents.on('destroyed', () => {
		if (onCleanup) {
			onCleanup(webContentsId, 'destroyed');
		}
	});
}
