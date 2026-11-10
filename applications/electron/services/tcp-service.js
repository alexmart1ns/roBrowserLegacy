import net from 'node:net';
import dns from 'node:dns/promises';
import { isBlockedIpAddress } from './network-policy.js';

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_SOCKETS_PER_OWNER = 8;
export const DEFAULT_MAX_WRITABLE_BYTES = 4 * 1024 * 1024;

function toZeroOffsetUint8Array(chunk) {
	const copy = new Uint8Array(chunk.byteLength);
	copy.set(chunk);
	return copy;
}

function mapNetworkErrorCode(err) {
	if (!err) {
		return 'ERR_NETWORK';
	}
	return err.code || 'ERR_NETWORK';
}

export class TcpService {
	constructor({
		policy,
		emitEvent,
		connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
		maxSocketsPerOwner = DEFAULT_MAX_SOCKETS_PER_OWNER,
		maxWritableBytes = DEFAULT_MAX_WRITABLE_BYTES,
		lookupFn = (hostname, opts) => dns.lookup(hostname, opts)
	}) {
		this._policy = policy;
		this._emitEvent = emitEvent;
		this._connectTimeoutMs = connectTimeoutMs;
		this._maxSocketsPerOwner = maxSocketsPerOwner;
		this._maxWritableBytes = maxWritableBytes;
		this._lookup = lookupFn;
		this._nextSocketId = 1;
		this._sockets = new Map(); // socketId -> record
	}

	_ownerSocketCount(ownerId) {
		let count = 0;
		for (const rec of this._sockets.values()) {
			if (rec.ownerId === ownerId && rec.state !== 'closed') {
				count++;
			}
		}
		return count;
	}

	async open(ownerId, { host, port, role = 'login' }) {
		if (this._ownerSocketCount(ownerId) >= this._maxSocketsPerOwner) {
			return {
				ok: false,
				code: 'ERR_TOO_MANY_SOCKETS',
				error: 'Maximum active socket limit reached for window'
			};
		}

		const auth = this._policy.authorizeConnection(ownerId, { host, port, role });
		if (!auth.allowed) {
			console.warn(`[TCP] Blocked connection for owner=${ownerId} target=${host}:${port} (${auth.code})`);
			return {
				ok: false,
				code: auth.code,
				error: auth.reason
			};
		}

		let connectHost = host;
		let family;
		if (net.isIP(host) === 0) {
			try {
				const resolved = await this._lookup(host, { verbatim: true });
				if (!resolved || !resolved.address || isBlockedIpAddress(resolved.address)) {
					console.warn(`[TCP] Blocked resolved IP for host=${host} (${resolved?.address})`);
					return {
						ok: false,
						code: 'ERR_POLICY_BLOCKED_IP',
						error: 'Resolved destination IP is blocked by security policy'
					};
				}
				connectHost = resolved.address;
				family = resolved.family;
			} catch (err) {
				return {
					ok: false,
					code: mapNetworkErrorCode(err),
					error: `DNS resolution failed for ${host}`
				};
			}
		}

		const socketId = this._nextSocketId++;
		const socket = new net.Socket();
		const record = {
			socketId,
			ownerId,
			host,
			port,
			role,
			socket,
			state: 'connecting', // 'connecting' | 'connected' | 'closing' | 'closed'
			connectTimer: null,
			completed: false,
			closedEmitted: false
		};
		this._sockets.set(socketId, record);

		const cleanupRecord = () => {
			if (record.connectTimer) {
				clearTimeout(record.connectTimer);
				record.connectTimer = null;
			}
			this._policy.markSocketClosed(ownerId, socketId);
			this._sockets.delete(socketId);
		};

		const failBeforeConnect = (code, message) => {
			if (record.state === 'closed') {
				return;
			}
			record.state = 'closed';
			cleanupRecord();
			socket.removeAllListeners();
			socket.destroy();
			if (!record.completed) {
				record.completed = true;
				this._emitEvent(ownerId, { type: 'error', socketId, code, message });
			}
		};

		record.connectTimer = setTimeout(() => {
			failBeforeConnect('ERR_CONNECT_TIMEOUT', `Connection timed out after ${this._connectTimeoutMs}ms`);
		}, this._connectTimeoutMs);

		socket.on('connect', () => {
			if (record.state !== 'connecting') {
				socket.destroy();
				return;
			}
			if (record.connectTimer) {
				clearTimeout(record.connectTimer);
				record.connectTimer = null;
			}
			record.state = 'connected';
			record.completed = true;
			socket.setNoDelay(true);
			this._policy.markSocketConnected(ownerId, socketId);
			this._emitEvent(ownerId, { type: 'connected', socketId });
		});

		socket.on('data', chunk => {
			if (record.state !== 'connected') {
				return;
			}
			this._emitEvent(ownerId, {
				type: 'data',
				socketId,
				data: toZeroOffsetUint8Array(chunk)
			});
		});

		socket.on('error', err => {
			const code = mapNetworkErrorCode(err);
			if (!record.completed) {
				failBeforeConnect(code, err?.message || 'Socket connection failed');
				return;
			}
			if (record.state === 'connected') {
				this._emitEvent(ownerId, {
					type: 'error',
					socketId,
					code,
					message: err?.message || 'Socket error'
				});
			}
		});

		socket.on('close', hadError => {
			if (record.state === 'closed') {
				return;
			}
			const wasCompleted = record.completed;
			record.state = 'closed';
			cleanupRecord();
			socket.removeAllListeners();

			if (!wasCompleted) {
				record.completed = true;
				this._emitEvent(ownerId, {
					type: 'error',
					socketId,
					code: 'ERR_CONNECTION_ABORTED',
					message: 'Socket closed before connection completed'
				});
				return;
			}

			if (!record.closedEmitted) {
				record.closedEmitted = true;
				this._emitEvent(ownerId, { type: 'closed', socketId, hadError: Boolean(hadError) });
			}
		});

		try {
			const connectOpts = { host: connectHost, port };
			if (family === 4 || family === 6) {
				connectOpts.family = family;
			}
			socket.connect(connectOpts);
		} catch (err) {
			failBeforeConnect(mapNetworkErrorCode(err), err?.message || 'Socket connect threw synchronously');
		}

		return { ok: true, socketId };
	}

	send(ownerId, socketId, bytes) {
		const record = this._sockets.get(socketId);
		if (!record || record.ownerId !== ownerId) {
			return { ok: false, code: 'ERR_SOCKET_NOT_FOUND', error: 'Socket not found' };
		}
		if (record.state !== 'connected' || record.socket.destroyed || !record.socket.writable) {
			return { ok: false, code: 'ERR_SOCKET_CLOSED', error: 'Socket is not connected/writable' };
		}
		if (record.socket.writableLength + bytes.byteLength > this._maxWritableBytes) {
			this.close(ownerId, socketId);
			return { ok: false, code: 'ERR_BACKPRESSURE', error: 'Outbound socket buffer limit exceeded' };
		}

		const written = record.socket.write(bytes);
		return { ok: true, flushed: written };
	}

	close(ownerId, socketId) {
		const record = this._sockets.get(socketId);
		if (!record || record.ownerId !== ownerId) {
			return { ok: false, code: 'ERR_SOCKET_NOT_FOUND' };
		}
		if (record.state === 'closed' || record.state === 'closing') {
			return { ok: true };
		}

		const wasCompleted = record.completed;
		record.state = 'closing';
		if (record.connectTimer) {
			clearTimeout(record.connectTimer);
			record.connectTimer = null;
		}
		this._policy.markSocketClosed(ownerId, socketId);

		record.socket.destroy();
		if (!wasCompleted && !record.completed) {
			record.completed = true;
			record.state = 'closed';
			this._sockets.delete(socketId);
			record.socket.removeAllListeners();
		}
		return { ok: true };
	}

	destroyOwnerSockets(ownerId) {
		for (const [socketId, record] of this._sockets.entries()) {
			if (record.ownerId === ownerId) {
				if (record.connectTimer) {
					clearTimeout(record.connectTimer);
					record.connectTimer = null;
				}
				record.state = 'closed';
				record.closedEmitted = true;
				record.socket.removeAllListeners();
				record.socket.destroy();
				this._sockets.delete(socketId);
			}
		}
		this._policy.clearOwner(ownerId);
	}

	getActiveSocketCount() {
		return this._sockets.size;
	}
}
