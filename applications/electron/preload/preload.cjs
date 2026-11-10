const { contextBridge, ipcRenderer } = require('electron');

const NETWORK_EVENT_CHANNEL = 'ro:net:event';
const ASSET_PROGRESS_CHANNEL = 'ro:assets:progress';

contextBridge.exposeInMainWorld('electronAPI', {
	isElectron: true,

	platform: {
		getInfo() {
			return ipcRenderer.invoke('ro:platform:getInfo');
		},
		openExternal(url) {
			return ipcRenderer.invoke('ro:platform:openExternal', url);
		},
		saveScreenshot(bytes) {
			return ipcRenderer.invoke('ro:platform:saveScreenshot', bytes);
		}
	},

	settings: {
		load() {
			return ipcRenderer.invoke('ro:settings:load');
		},
		save(partial) {
			return ipcRenderer.invoke('ro:settings:save', partial);
		},
		reset() {
			return ipcRenderer.invoke('ro:settings:reset');
		}
	},

	diagnostics: {
		log(entry) {
			return ipcRenderer.invoke('ro:diagnostics:log', entry);
		},
		getSnapshot() {
			return ipcRenderer.invoke('ro:diagnostics:getSnapshot');
		},
		exportReport() {
			return ipcRenderer.invoke('ro:diagnostics:export');
		}
	},

	windowControls: {
		setFullscreen(fullscreen) {
			return ipcRenderer.invoke('ro:window:setFullscreen', Boolean(fullscreen));
		},
		setSize(width, height) {
			return ipcRenderer.invoke('ro:window:setSize', { width, height });
		},
		getState() {
			return ipcRenderer.invoke('ro:window:getState');
		}
	},

	assets: {
		selectDirectory() {
			return ipcRenderer.invoke('ro:assets:selectDirectory');
		},
		getStatus() {
			return ipcRenderer.invoke('ro:assets:getStatus');
		},
		reindex() {
			return ipcRenderer.invoke('ro:assets:reindex');
		},
		clearCache() {
			return ipcRenderer.invoke('ro:assets:clearCache');
		},
		onProgress(callback) {
			if (typeof callback !== 'function') {
				throw new TypeError('assets.onProgress requires a function callback');
			}
			const handler = (_event, payload) => {
				callback(payload);
			};
			ipcRenderer.on(ASSET_PROGRESS_CHANNEL, handler);
			return () => {
				ipcRenderer.removeListener(ASSET_PROGRESS_CHANNEL, handler);
			};
		}
	},

	network: {
		registerServers(servers) {
			return ipcRenderer.invoke('ro:net:registerServers', servers);
		},
		open(options) {
			return ipcRenderer.invoke('ro:net:open', options);
		},
		send(socketId, data) {
			return ipcRenderer.invoke('ro:net:send', socketId, data);
		},
		close(socketId) {
			return ipcRenderer.invoke('ro:net:close', socketId);
		},
		onEvent(callback) {
			if (typeof callback !== 'function') {
				throw new TypeError('network.onEvent requires a function callback');
			}
			const handler = (_event, payload) => {
				callback(payload);
			};
			ipcRenderer.on(NETWORK_EVENT_CHANNEL, handler);
			return () => {
				ipcRenderer.removeListener(NETWORK_EVENT_CHANNEL, handler);
			};
		}
	}
});
