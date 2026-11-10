const { contextBridge, ipcRenderer } = require('electron');

const NETWORK_EVENT_CHANNEL = 'ro:net:event';

contextBridge.exposeInMainWorld('electronAPI', {
	isElectron: true,

	platform: {
		getInfo() {
			return ipcRenderer.invoke('ro:platform:getInfo');
		},
		openExternal(url) {
			return ipcRenderer.invoke('ro:platform:openExternal', url);
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
