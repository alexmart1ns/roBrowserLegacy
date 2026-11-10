/**
 * Build initial ROConfig for Electron Desktop renderer without inline HTML scripts
 * or hardcoded development/public endpoints.
 */

function readStoredJson(storage, key) {
	try {
		const raw = storage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

export function syncRendererPreferencesToLocalStorage(settings, storage = window.localStorage) {
	if (!settings || !settings.preferences || !storage) {
		return;
	}
	const prefs = settings.preferences;

	const existingAudio = readStoredJson(storage, 'Audio');
	const nextAudio = existingAudio && existingAudio._version === 1.0 ? existingAudio : { _version: 1.0 };
	nextAudio.BGM = {
		...(nextAudio.BGM || {}),
		play: Boolean(prefs.bgmEnabled),
		volume: Number.isFinite(Number(prefs.bgmVolume)) ? Number(prefs.bgmVolume) : 0.5
	};
	nextAudio.Sound = {
		...(nextAudio.Sound || {}),
		play: Boolean(prefs.soundEnabled),
		volume: Number.isFinite(Number(prefs.soundVolume)) ? Number(prefs.soundVolume) : 0.5
	};
	storage.setItem('Audio', JSON.stringify(nextAudio));

	const existingGraphics = readStoredJson(storage, 'Graphics');
	const nextGraphics = existingGraphics && existingGraphics._version === 1.1 ? existingGraphics : { _version: 1.1 };
	nextGraphics.screensize = prefs.fullscreen ? 'full' : prefs.screensize || '1024x768';
	nextGraphics.quality = Number.isFinite(Number(prefs.quality)) ? Number(prefs.quality) : 100;
	nextGraphics.cursor = prefs.showCursor === undefined ? true : Boolean(prefs.showCursor);
	nextGraphics.fpslimit = Number.isFinite(Number(prefs.fpslimit)) ? Number(prefs.fpslimit) : 60;
	storage.setItem('Graphics', JSON.stringify(nextGraphics));
}

export function resolveActiveServer(settings) {
	const servers = Array.isArray(settings?.servers) ? settings.servers : [];
	if (servers.length === 0) {
		return null;
	}
	if (settings.activeServerId) {
		const matched = servers.find(s => s.id === settings.activeServerId);
		if (matched) {
			return matched;
		}
	}
	return servers[0];
}

export function isAssetsReady(assetsStatus) {
	return Boolean(
		assetsStatus?.configured && ((assetsStatus.totalGrfEntries || 0) > 0 || (assetsStatus.looseCount || 0) > 0)
	);
}

export function buildDesktopROConfig({ isDev = false, settings = null, assetsStatus = null, overrides = {} } = {}) {
	const activeServer = resolveActiveServer(settings);
	const configuredServers = Array.isArray(settings?.servers) ? settings.servers : [];
	const serversForROConfig = activeServer
		? [
				{
					display: activeServer.display,
					desc: activeServer.desc || '',
					address: activeServer.address,
					port: activeServer.port,
					version: activeServer.version ?? 55,
					langtype: activeServer.langtype ?? 1,
					packetver: activeServer.packetver || 'executable',
					renewal: Boolean(activeServer.renewal),
					forceUseAddress: Boolean(activeServer.forceUseAddress),
					packetKeys: activeServer.packetKeys ?? false
				}
			]
		: [];

	const hasAnyClientSource = Boolean(isAssetsReady(assetsStatus) || activeServer?.remoteClient);
	const skipIntro = Boolean(
		settings?.launcher?.skipIntroWhenReady !== false && hasAnyClientSource && configuredServers.length > 0
	);

	const baseConfig = {
		target: typeof document !== 'undefined' ? document.getElementById('robrowser') : null,
		type: 2,
		application: 1,
		development: Boolean(isDev || settings?.debugLogging),
		remoteClient: activeServer?.remoteClient || '',
		webserverAddress: activeServer?.webserverAddress || '',
		registrationweb: activeServer?.registrationweb || '',
		servers: serversForROConfig,
		packetver: activeServer?.packetver || assetsStatus?.detectedPacketVer || 'executable',
		packetDump: false,
		skipServerList: true,
		skipIntro,
		quality: settings?.preferences?.quality ?? 100,
		aura: {},
		autoLogin: [],
		BGMFileExtension: ['mp3'],
		calculateHash: false,
		CameraMaxZoomOut: 5,
		charBlockSize: 0,
		clientHash: null,
		clientVersionMode: 'PacketVer',
		disableConsole: false,
		enableAchievements: true,
		enableBank: true,
		enableCashShop: true,
		enableCheckAttendance: true,
		enableDmgSuffix: true,
		enableHomunAutoFeed: true,
		enableMapName: true,
		enableRoulette: true,
		FirstPersonCamera: false,
		grfList: settings?.assets?.grfList?.length ? settings.assets.grfList : null,
		hashFiles: [],
		loadLua: true,
		customItemInfo: [],
		onReady: null,
		plugins: {},
		saveFiles: false,
		ThirdPersonCamera: false,
		transitionDuration: 500,
		restoreChatFocus: false,
		useSystemFolderFont: false
	};

	return Object.assign(baseConfig, overrides);
}
