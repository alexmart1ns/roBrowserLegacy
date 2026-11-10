import net from 'node:net';

const BLOCKED_REDIRECT_PORTS = new Set([
	21, 22, 23, 25, 53, 80, 110, 111, 135, 137, 138, 139, 143, 389, 443, 445, 512, 513, 514, 636, 1433, 1521, 3306,
	3389, 5432, 5900, 6379, 8080, 9200, 11211, 27017
]);

function normalizeHost(host) {
	return String(host || '')
		.trim()
		.toLowerCase();
}

function serverKey(host, port) {
	return `${normalizeHost(host)}:${Number(port)}`;
}

export function isBlockedIpAddress(ip) {
	if (!ip || typeof ip !== 'string') {
		return true;
	}

	const normalized = ip.trim().toLowerCase();
	const ipVersion = net.isIP(normalized);
	if (ipVersion === 0) {
		return false;
	}

	if (ipVersion === 4) {
		const parts = normalized.split('.').map(n => Number.parseInt(n, 10));
		if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
			return true;
		}
		const [a, b] = parts;
		// 0.0.0.0/8 ("this" network), 169.254.0.0/16 (link-local / cloud metadata), 224.0.0.0/4 (multicast), 255.255.255.255
		if (a === 0 || (a === 169 && b === 254) || a >= 224) {
			return true;
		}
		return false;
	}

	// IPv6: unspecified (::), IPv4-mapped metadata/multicast, link-local (fe80::/10), multicast (ff00::/8)
	if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') {
		return true;
	}
	if (normalized.startsWith('::ffff:')) {
		return isBlockedIpAddress(normalized.slice(7));
	}
	if (/^fe[89ab][0-9a-f]:/.test(normalized) || normalized.startsWith('ff')) {
		return true;
	}
	return false;
}

export function isBlockedRedirectPort(port) {
	return port < 1024 || BLOCKED_REDIRECT_PORTS.has(port);
}

export class NetworkDestinationPolicy {
	constructor({ sessionTtlMs = 30 * 60 * 1000 } = {}) {
		this._sessionTtlMs = sessionTtlMs;
		this._configuredByOwner = new Map(); // ownerId -> Set<"host:port">
		this._authorizedSessions = new Map(); // ownerId -> { expiresAt, activeSockets: Set<number> }
	}

	setConfiguredServers(ownerId, servers) {
		const set = new Set();
		if (Array.isArray(servers)) {
			for (const srv of servers) {
				if (!srv || typeof srv !== 'object') {
					continue;
				}
				const host = normalizeHost(srv.address ?? srv.host);
				const port = typeof srv.port === 'number' ? srv.port : Number.parseInt(String(srv.port ?? ''), 10);
				if (!host || /[\s\0]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
					continue;
				}
				if (isBlockedIpAddress(host)) {
					continue;
				}
				set.add(serverKey(host, port));
			}
		}
		this._configuredByOwner.set(ownerId, set);
		return set.size;
	}

	authorizeConnection(ownerId, { host, port, role = 'login' }) {
		const normalizedHost = normalizeHost(host);
		const numericPort = Number(port);

		if (!normalizedHost || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
			return { allowed: false, code: 'ERR_POLICY_INVALID_TARGET', reason: 'Invalid host or port' };
		}

		if (isBlockedIpAddress(normalizedHost)) {
			return {
				allowed: false,
				code: 'ERR_POLICY_BLOCKED_IP',
				reason: `Destination IP "${normalizedHost}" is blocked by security policy`
			};
		}

		const configured = this._configuredByOwner.get(ownerId);
		const key = serverKey(normalizedHost, numericPort);
		const isExplicitlyConfigured = Boolean(configured && configured.has(key));

		if (isExplicitlyConfigured) {
			return { allowed: true, reason: 'EXPLICIT_CONFIG' };
		}

		if (role === 'login') {
			return {
				allowed: false,
				code: 'ERR_POLICY_UNCONFIGURED_SERVER',
				reason: `Login destination "${key}" is not in configured server list`
			};
		}

		// char / map redirects require an active/recent authorized login session and safe RO port range
		if (isBlockedRedirectPort(numericPort)) {
			return {
				allowed: false,
				code: 'ERR_POLICY_BLOCKED_PORT',
				reason: `Redirect port ${numericPort} is blocked by security policy`
			};
		}

		const session = this._authorizedSessions.get(ownerId);
		const now = Date.now();
		if (!session || (session.activeSockets.size === 0 && session.expiresAt < now)) {
			return {
				allowed: false,
				code: 'ERR_POLICY_NO_SESSION',
				reason: `Redirect to "${key}" rejected without active authorized server session`
			};
		}

		return { allowed: true, reason: 'AUTHORIZED_SESSION_REDIRECT' };
	}

	markSocketConnected(ownerId, socketId) {
		let session = this._authorizedSessions.get(ownerId);
		if (!session) {
			session = { expiresAt: Date.now() + this._sessionTtlMs, activeSockets: new Set() };
			this._authorizedSessions.set(ownerId, session);
		}
		session.activeSockets.add(socketId);
		session.expiresAt = Date.now() + this._sessionTtlMs;
	}

	markSocketClosed(ownerId, socketId) {
		const session = this._authorizedSessions.get(ownerId);
		if (!session) {
			return;
		}
		session.activeSockets.delete(socketId);
		session.expiresAt = Date.now() + this._sessionTtlMs;
	}

	clearOwner(ownerId) {
		this._configuredByOwner.delete(ownerId);
		this._authorizedSessions.delete(ownerId);
	}
}
