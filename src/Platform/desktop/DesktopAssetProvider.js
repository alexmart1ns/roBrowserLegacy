/**
 * Platform/desktop/DesktopAssetProvider.js
 *
 * Desktop AssetProvider running inside browser/worker contexts.
 * Communicates with main-process LocalAssetVfs via the privileged ro-asset:// protocol
 * so Chromium Web Workers never need Node integration.
 */

const ASSET_BASE_URL = 'ro-asset://local';

function encodeAssetUrl(filename) {
	const cleaned = String(filename || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+/, '');
	const encoded = cleaned
		.split('/')
		.filter(Boolean)
		.map(seg => encodeURIComponent(seg))
		.join('/');
	return `${ASSET_BASE_URL}/asset/${encoded}`;
}

export class DesktopAssetProvider {
	constructor({ fetchImpl = null, baseUrl = ASSET_BASE_URL } = {}) {
		this._fetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
		this._baseUrl = baseUrl;
		this._ready = false;
		this._stats = null;
	}

	static isAvailable() {
		if (typeof self !== 'undefined' && self.location?.protocol === 'app:') {
			return true;
		}
		if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
			return true;
		}
		return false;
	}

	async initialize() {
		if (!this._fetch) {
			this._ready = false;
			return { ready: false, count: 0 };
		}

		try {
			const res = await this._fetch(`${this._baseUrl}/status`);
			if (!res.ok) {
				this._ready = false;
				return { ready: false, count: 0 };
			}
			const status = await res.json();
			this._stats = status;
			this._ready = Boolean(status?.configured);
			const count = (status?.grfCount || 0) + (status?.looseCount > 0 ? 1 : 0);
			return { ready: this._ready, count, stats: status };
		} catch {
			this._ready = false;
			return { ready: false, count: 0 };
		}
	}

	isReady() {
		return this._ready;
	}

	async exists(filename) {
		if (!this._ready || !this._fetch) {
			return false;
		}
		try {
			const url = this._buildAssetUrl(filename);
			const res = await this._fetch(url, { method: 'HEAD' });
			return res.ok;
		} catch {
			return false;
		}
	}

	async search(regex) {
		if (!this._ready || !this._fetch || !regex) {
			return [];
		}
		try {
			const source = regex instanceof RegExp ? regex.source : String(regex);
			const flags = regex instanceof RegExp ? regex.flags : '';
			const res = await this._fetch(`${this._baseUrl}/search`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source, flags })
			});
			if (!res.ok) {
				return [];
			}
			const matches = await res.json();
			return Array.isArray(matches) ? matches : [];
		} catch {
			return [];
		}
	}

	async getBytes(filename) {
		if (!this._ready || !this._fetch) {
			return { found: false, data: null, error: 'DESKTOP_VFS_NOT_READY' };
		}

		const url = this._buildAssetUrl(filename);

		// Stream BGM audio directly with Range support instead of buffering into RAM
		if (/^bgm\//i.test(filename.replace(/\\/g, '/').replace(/^\/+/, '')) && /\.(mp3|ogg|wav)$/i.test(filename)) {
			const headRes = await this._fetch(url, { method: 'HEAD' });
			if (headRes.ok) {
				return { found: true, data: url, source: 'desktop-stream' };
			}
			return { found: false, data: null, error: 'NOT_FOUND' };
		}

		try {
			const res = await this._fetch(url, { method: 'GET' });
			if (!res.ok) {
				return { found: false, data: null, error: `HTTP_${res.status}` };
			}
			const buffer = await res.arrayBuffer();
			return { found: true, data: buffer, source: 'desktop-vfs' };
		} catch (err) {
			return { found: false, data: null, error: err?.message || 'FETCH_ERROR' };
		}
	}

	async close() {
		this._ready = false;
		this._stats = null;
	}

	async invalidate() {
		this._ready = false;
		this._stats = null;
	}

	async getStats() {
		if (!this._fetch) {
			return this._stats || { configured: false };
		}
		const initRes = await this.initialize();
		return initRes.stats || { configured: false };
	}

	async getPriority() {
		const stats = await this.getStats();
		return Array.isArray(stats?.priority) ? stats.priority : [];
	}

	_buildAssetUrl(filename) {
		if (this._baseUrl === ASSET_BASE_URL) {
			return encodeAssetUrl(filename);
		}
		const cleaned = String(filename || '')
			.trim()
			.replace(/\\/g, '/')
			.replace(/^\/+/, '');
		const encoded = cleaned
			.split('/')
			.filter(Boolean)
			.map(seg => encodeURIComponent(seg))
			.join('/');
		return `${this._baseUrl}/asset/${encoded}`;
	}
}

export default DesktopAssetProvider;
