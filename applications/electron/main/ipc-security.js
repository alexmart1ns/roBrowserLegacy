import { APP_HOST, APP_SCHEME } from './protocol-security.js';

export const MAX_IPC_PACKET_BYTES = 1024 * 1024; // 1 MiB per send
export const MAX_HOST_LENGTH = 255;
export const MAX_EXTERNAL_URL_LENGTH = 2048;

export function isValidRendererOrigin(frameUrl, { isDev = false, devOrigin = 'http://localhost:3000' } = {}) {
	if (!frameUrl || typeof frameUrl !== 'string') {
		return false;
	}
	try {
		const parsed = new URL(frameUrl);
		if (isDev && devOrigin) {
			const expectedDevOrigin = new URL(devOrigin).origin;
			if (parsed.origin === expectedDevOrigin) {
				return true;
			}
		}
		return parsed.protocol === `${APP_SCHEME}:` && parsed.hostname === APP_HOST;
	} catch {
		return false;
	}
}

export function assertValidIpcSender(event, options = {}) {
	if (!event || !event.senderFrame || !event.sender) {
		throw new Error('IPC_INVALID_SENDER');
	}
	if (event.senderFrame !== event.sender.mainFrame) {
		throw new Error('IPC_SUBFRAME_DENIED');
	}
	if (!isValidRendererOrigin(event.senderFrame.url, options)) {
		throw new Error('IPC_ORIGIN_DENIED');
	}
	return event.sender.id;
}

export function validateExternalUrl(rawUrl) {
	if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_EXTERNAL_URL_LENGTH) {
		return { ok: false, reason: 'INVALID_URL_LENGTH' };
	}

	let parsed;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return { ok: false, reason: 'INVALID_URL' };
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return { ok: false, reason: 'DISALLOWED_SCHEME' };
	}

	if (parsed.username || parsed.password) {
		return { ok: false, reason: 'CREDENTIALS_IN_URL' };
	}

	return { ok: true, url: parsed.toString() };
}

export function validateSocketId(socketId) {
	if (!Number.isSafeInteger(socketId) || socketId <= 0) {
		return null;
	}
	return socketId;
}

export function validateOpenSocketPayload(payload) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return { ok: false, reason: 'INVALID_PAYLOAD' };
	}

	const { host, port, role = 'login' } = payload;
	if (typeof host !== 'string') {
		return { ok: false, reason: 'INVALID_HOST' };
	}

	const trimmedHost = host.trim();
	if (trimmedHost.length === 0 || trimmedHost.length > MAX_HOST_LENGTH || /[\s\0]/.test(trimmedHost)) {
		return { ok: false, reason: 'INVALID_HOST' };
	}

	const numericPort = typeof port === 'number' ? port : Number.parseInt(String(port), 10);
	if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
		return { ok: false, reason: 'INVALID_PORT' };
	}

	if (role !== 'login' && role !== 'char' && role !== 'map') {
		return { ok: false, reason: 'INVALID_ROLE' };
	}

	return {
		ok: true,
		host: trimmedHost,
		port: numericPort,
		role
	};
}

export function toTightUint8Array(data) {
	let view;
	if (data instanceof Uint8Array) {
		view = data;
	} else if (data instanceof ArrayBuffer) {
		view = new Uint8Array(data);
	} else if (ArrayBuffer.isView(data)) {
		view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	} else {
		return { ok: false, reason: 'INVALID_BINARY_PAYLOAD' };
	}

	if (view.byteLength === 0) {
		return { ok: false, reason: 'EMPTY_PAYLOAD' };
	}

	if (view.byteLength > MAX_IPC_PACKET_BYTES) {
		return { ok: false, reason: 'PAYLOAD_TOO_LARGE' };
	}

	const copy = new Uint8Array(view.byteLength);
	copy.set(view);
	return { ok: true, bytes: copy };
}
