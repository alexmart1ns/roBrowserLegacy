import { buildDesktopROConfig, isAssetsReady, syncRendererPreferencesToLocalStorage } from './config.js';
import { mountDesktopLauncher } from './launcher.js';

const AUTOSTART_FLAG = 'ro_desktop_autostart';

function getDesiredHttpOrigins(settings) {
	const origins = [];
	const candidates = [];
	if (Array.isArray(settings?.servers)) {
		for (const srv of settings.servers) {
			if (srv?.webserverAddress) {
				candidates.push(srv.webserverAddress);
			}
			if (srv?.remoteClient) {
				candidates.push(srv.remoteClient);
			}
		}
	}
	for (const raw of candidates) {
		try {
			const parsed = new URL(raw);
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
				origins.push(parsed.origin);
			}
		} catch {
			// Ignore invalid URL
		}
	}
	return origins;
}

async function startDesktopRenderer() {
	const isDev = Boolean(import.meta.env && import.meta.env.DEV);
	const api = window.electronAPI;

	if (!api?.isElectron) {
		window.ROConfig = buildDesktopROConfig({ isDev });
		await import('src/main.js');
		return;
	}

	const [platformInfo, settings, assetsStatus] = await Promise.all([
		api.platform.getInfo(),
		api.settings.load(),
		api.assets.getStatus()
	]);

	const initialOrigins = new Set(platformInfo?.allowedConnectOrigins || []);

	const launchGame = async ({ settings: launchSettings, assetsStatus: launchAssets, unmount } = {}) => {
		const latestSettings = launchSettings || (await api.settings.load());
		const latestAssets = launchAssets || (await api.assets.getStatus());

		const neededOrigins = getDesiredHttpOrigins(latestSettings);
		const needsCspRefresh = !isDev && neededOrigins.some(origin => !initialOrigins.has(origin));
		if (needsCspRefresh) {
			sessionStorage.setItem(AUTOSTART_FLAG, '1');
			window.location.reload();
			return;
		}

		if (unmount) {
			unmount();
		}

		syncRendererPreferencesToLocalStorage(latestSettings);
		await api.network.registerServers(latestSettings.servers || []);

		if (latestSettings.preferences?.fullscreen) {
			await api.windowControls.setFullscreen(true).catch(() => {});
		}

		window.ROConfig = buildDesktopROConfig({
			isDev,
			settings: latestSettings,
			assetsStatus: latestAssets
		});

		await import('src/main.js');
	};

	const shouldAutostartOnce = sessionStorage.getItem(AUTOSTART_FLAG) === '1';
	if (shouldAutostartOnce) {
		sessionStorage.removeItem(AUTOSTART_FLAG);
		await launchGame({ settings, assetsStatus });
		return;
	}

	const hasAnyServer = Array.isArray(settings?.servers) && settings.servers.length > 0;
	const hasAnyAssets = Boolean(isAssetsReady(assetsStatus) || settings?.servers?.some(s => s.remoteClient));
	if (settings?.launcher?.autoLaunch && hasAnyServer && hasAnyAssets) {
		await launchGame({ settings, assetsStatus });
		return;
	}

	// Hide preloader so the Launcher opens cleanly on startup
	const preloader = document.getElementById('ro-preloader');
	if (preloader) {
		preloader.remove();
	}

	mountDesktopLauncher({
		platformInfo,
		initialSettings: settings,
		initialAssetsStatus: assetsStatus,
		onLaunch: launchGame
	});
}

startDesktopRenderer().catch(err => {
	console.error('Desktop renderer startup failed:', err);
});
