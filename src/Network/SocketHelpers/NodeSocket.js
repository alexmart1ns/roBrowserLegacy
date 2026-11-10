/**
 * Network/SocketHelpers/NodeSocket.js
 *
 * TCP socket via Electron main-process IPC bridge (contextBridge).
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @author Vincent Thibault, AoShinHo
 */

const _activeSockets = new Map();
const _pendingEvents = new Map();
let _unsubscribeEvents = null;

function ensureEventSubscription() {
	if (_unsubscribeEvents || typeof window === 'undefined' || !window.electronAPI?.network?.onEvent) {
		return;
	}
	_unsubscribeEvents = window.electronAPI.network.onEvent(event => {
		if (!event || !event.socketId) {
			return;
		}
		const target = _activeSockets.get(event.socketId);
		if (target) {
			target._handleIpcEvent(event);
			return;
		}
		// Buffer events if an IPC event arrives before open() Promise settles
		let queue = _pendingEvents.get(event.socketId);
		if (!queue) {
			queue = [];
			_pendingEvents.set(event.socketId, queue);
		}
		queue.push(event);
	});
}

function toTightUint8Array(data) {
	if (data instanceof Uint8Array) {
		if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
			return data;
		}
		return data.slice();
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
	}
	return new Uint8Array(data);
}

class Socket {
	/**
	 * Electron TCP Socket (IPC-backed in main process)
	 *
	 * @param {string} host
	 * @param {number} port
	 * @param {string} [_proxy]
	 * @param {'login'|'char'|'map'} [role]
	 */
	constructor(host, port, _proxy, role = 'login') {
		this.connected = false;
		this._socketId = null;
		this._state = 'connecting'; // 'connecting' | 'connected' | 'closing' | 'closed'
		this._completed = false;
		this._completeSuccess = false;
		this._closedEmitted = false;
		this._lastError = null;

		ensureEventSubscription();

		const numericPort = typeof port === 'number' ? port : Number.parseInt(String(port), 10);

		window.electronAPI.network
			.open({ host, port: numericPort, role })
			.then(res => {
				if (!res || !res.ok || !res.socketId) {
					this._lastError = res || { code: 'ERR_OPEN_FAILED', error: 'Failed to open TCP socket' };
					this._state = 'closed';
					this.connected = false;
					this._emitComplete(false);
					return;
				}

				const sid = res.socketId;
				if (this._state === 'closing' || this._state === 'closed') {
					window.electronAPI.network.close(sid).catch(() => {});
					_pendingEvents.delete(sid);
					return;
				}

				this._socketId = sid;
				_activeSockets.set(sid, this);

				const queued = _pendingEvents.get(sid);
				if (queued) {
					_pendingEvents.delete(sid);
					for (const evt of queued) {
						this._handleIpcEvent(evt);
					}
				}
			})
			.catch(err => {
				this._lastError = { code: 'ERR_IPC_OPEN', error: err?.message || 'IPC open error' };
				this._state = 'closed';
				this.connected = false;
				this._emitComplete(false);
			});
	}

	/**
	 * @return {boolean} running in Electron with network bridge
	 */
	static isSupported() {
		return Boolean(typeof window !== 'undefined' && window.electronAPI?.isElectron && window.electronAPI?.network);
	}

	_emitComplete(success) {
		if (this._completed) {
			return;
		}
		this._completed = true;
		this._completeSuccess = Boolean(success);
		if (this.onComplete) {
			this.onComplete(this._completeSuccess);
		}
	}

	_emitClose() {
		if (!this._completeSuccess || this._closedEmitted) {
			return;
		}
		this._closedEmitted = true;
		if (this.onClose) {
			this.onClose();
		}
	}

	_handleIpcEvent(event) {
		switch (event.type) {
			case 'connected':
				if (this._state !== 'connecting') {
					return;
				}
				this._state = 'connected';
				this.connected = true;
				this._emitComplete(true);
				break;

			case 'data':
				if (this._state !== 'connected') {
					return;
				}
				if (this.onMessage) {
					this.onMessage(toTightUint8Array(event.data));
				}
				break;

			case 'error':
				this._lastError = { code: event.code, message: event.message };
				if (!this._completed) {
					this._state = 'closed';
					this.connected = false;
					if (this._socketId !== null) {
						_activeSockets.delete(this._socketId);
					}
					this._emitComplete(false);
				}
				break;

			case 'closed':
				this._state = 'closed';
				this.connected = false;
				if (this._socketId !== null) {
					_activeSockets.delete(this._socketId);
				}
				if (!this._completed) {
					this._emitComplete(false);
				} else {
					this._emitClose();
				}
				break;
		}
	}

	/**
	 * @param {ArrayBuffer|ArrayBufferView} buffer
	 */
	send(buffer) {
		if (this._state !== 'connected' || this._socketId === null) {
			return;
		}
		const payload = toTightUint8Array(buffer);
		if (payload.byteLength === 0) {
			return;
		}
		window.electronAPI.network
			.send(this._socketId, payload)
			.then(res => {
				if (res && !res.ok && res.code === 'ERR_BACKPRESSURE') {
					console.warn('[NodeSocket] Backpressure limit exceeded, closing socket');
					this.close();
				}
			})
			.catch(() => {
				// Socket may already be closed during teardown
			});
	}

	/**
	 * Close connection
	 */
	close() {
		if (this._state === 'closed' || this._state === 'closing') {
			return;
		}
		const wasConnected = this._state === 'connected';
		this._state = 'closing';
		this.connected = false;

		if (this._socketId !== null) {
			const sid = this._socketId;
			_activeSockets.delete(sid);
			_pendingEvents.delete(sid);
			window.electronAPI.network.close(sid).catch(() => {});
		}

		this._state = 'closed';
		if (wasConnected) {
			this._emitClose();
		}
	}
}
export default Socket;
