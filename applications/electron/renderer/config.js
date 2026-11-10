/**
 * Build initial ROConfig for Electron Desktop renderer without inline HTML scripts
 * or hardcoded development/public endpoints.
 */
export function buildDesktopROConfig({ isDev = false, overrides = {} } = {}) {
	const baseConfig = {
		target: document.getElementById('robrowser'),
		type: 2,
		application: 1,
		development: Boolean(isDev),
		remoteClient: '',
		webserverAddress: '',
		packetDump: false,
		skipServerList: true,
		skipIntro: false,
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
		grfList: null,
		hashFiles: [],
		loadLua: true,
		customItemInfo: [],
		onReady: null,
		plugins: {},
		registrationweb: '',
		saveFiles: false,
		ThirdPersonCamera: false,
		transitionDuration: 500,
		restoreChatFocus: false,
		useSystemFolderFont: false
	};

	return Object.assign(baseConfig, overrides);
}
