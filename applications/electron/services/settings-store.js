import fs from 'node:fs';
import path from 'node:path';
import { sanitizeValue } from './logger.js';

export const SETTINGS_SCHEMA_VERSION = 1;

const VALID_SCREEN_SIZES = new Set(['640x480', '800x600', '1024x768', '1280x800', '1400x900', '1680x1050', 'full']);
const VALID_FPS_LIMITS = new Set([30, 60, 120, 144, 0]);

export function createDefaultSettings() {
	return {
		schemaVersion: SETTINGS_SCHEMA_VERSION,
		assets: {
			directory: null,
			grfList: null
		},
		servers: [],
		activeServerId: null,
		launcher: {
			autoLaunch: false,
			skipIntroWhenReady: true
		},
		preferences: {
			screensize: '1024x768',
			fullscreen: false,
			quality: 100,
			bgmVolume: 0.5,
			bgmEnabled: true,
			soundVolume: 0.5,
			soundEnabled: true,
			fpslimit: 60,
			showCursor: true
		},
		windowBounds: {
			width: 1024,
			height: 768,
			x: null,
			y: null,
			maximized: false
		},
		updates: {
			channel: 'stable',
			appFeedUrl: '',
			assetManifestUrl: ''
		},
		debugLogging: false
	};
}

function validateOptionalHttpUrl(raw) {
	if (typeof raw !== 'string') {
		return '';
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		return '';
	}
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return parsed.toString().replace(/\/?$/, '/');
		}
	} catch {
		// Invalid URL
	}
	return '';
}

function validatePacketKeys(val) {
	if (typeof val === 'boolean') {
		return val;
	}
	if (Array.isArray(val) && val.length === 3 && val.every(n => Number.isInteger(n))) {
		return val.slice(0, 3);
	}
	return false;
}

export function validateServerEntry(raw, fallbackIndex = 0) {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const address = typeof raw.address === 'string' ? raw.address.trim() : '';
	const port = typeof raw.port === 'number' ? raw.port : Number.parseInt(String(raw.port ?? ''), 10);
	if (!address || address.length > 255 || /[\s\0]/.test(address)) {
		return null;
	}
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return null;
	}

	const display =
		typeof raw.display === 'string' && raw.display.trim() ? raw.display.trim().slice(0, 64) : `${address}:${port}`;

	let packetver = 'executable';
	if (typeof raw.packetver === 'number' && Number.isInteger(raw.packetver) && raw.packetver >= 20030000) {
		packetver = raw.packetver;
	} else if (typeof raw.packetver === 'string') {
		const pvTrim = raw.packetver.trim();
		if (/^\d{8}$/.test(pvTrim)) {
			packetver = Number.parseInt(pvTrim, 10);
		}
	}

	const version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : 55;
	const langtype = Number.isInteger(Number(raw.langtype)) ? Number(raw.langtype) : 1;

	return {
		id:
			typeof raw.id === 'string' && raw.id.trim()
				? raw.id.trim().slice(0, 64)
				: `srv-${fallbackIndex}-${address}-${port}`,
		display,
		desc: typeof raw.desc === 'string' ? raw.desc.trim().slice(0, 128) : '',
		address,
		port,
		version,
		langtype,
		packetver,
		renewal: Boolean(raw.renewal),
		forceUseAddress: Boolean(raw.forceUseAddress),
		packetKeys: validatePacketKeys(raw.packetKeys),
		webserverAddress: validateOptionalHttpUrl(raw.webserverAddress).replace(/\/$/, ''),
		remoteClient: validateOptionalHttpUrl(raw.remoteClient),
		registrationweb: validateOptionalHttpUrl(raw.registrationweb).replace(/\/$/, '')
	};
}

export function normalizeSettings(input) {
	const defaults = createDefaultSettings();
	if (!input || typeof input !== 'object') {
		return defaults;
	}

	const out = createDefaultSettings();

	if (input.assets && typeof input.assets === 'object') {
		if (typeof input.assets.directory === 'string' && input.assets.directory.trim()) {
			out.assets.directory = input.assets.directory.trim();
		}
		if (Array.isArray(input.assets.grfList)) {
			out.assets.grfList = input.assets.grfList
				.map(s => String(s || '').trim())
				.filter(Boolean)
				.slice(0, 32);
		}
	}

	if (Array.isArray(input.servers)) {
		const seenIds = new Set();
		input.servers.slice(0, 32).forEach((rawSrv, idx) => {
			const clean = validateServerEntry(rawSrv, idx);
			if (clean && !seenIds.has(clean.id)) {
				seenIds.add(clean.id);
				out.servers.push(clean);
			}
		});
	}

	if (typeof input.activeServerId === 'string' && out.servers.some(s => s.id === input.activeServerId)) {
		out.activeServerId = input.activeServerId;
	} else if (out.servers.length > 0) {
		out.activeServerId = out.servers[0].id;
	}

	if (input.launcher && typeof input.launcher === 'object') {
		out.launcher.autoLaunch = Boolean(input.launcher.autoLaunch);
		out.launcher.skipIntroWhenReady =
			input.launcher.skipIntroWhenReady === undefined ? true : Boolean(input.launcher.skipIntroWhenReady);
	}

	if (input.preferences && typeof input.preferences === 'object') {
		const p = input.preferences;
		if (typeof p.screensize === 'string' && VALID_SCREEN_SIZES.has(p.screensize)) {
			out.preferences.screensize = p.screensize;
		}
		out.preferences.fullscreen = Boolean(p.fullscreen);
		const q = Number(p.quality);
		if (Number.isFinite(q) && q >= 25 && q <= 100) {
			out.preferences.quality = Math.round(q);
		}
		const bgmVol = Number(p.bgmVolume);
		if (Number.isFinite(bgmVol) && bgmVol >= 0 && bgmVol <= 1) {
			out.preferences.bgmVolume = bgmVol;
		}
		out.preferences.bgmEnabled = p.bgmEnabled === undefined ? true : Boolean(p.bgmEnabled);
		const sndVol = Number(p.soundVolume);
		if (Number.isFinite(sndVol) && sndVol >= 0 && sndVol <= 1) {
			out.preferences.soundVolume = sndVol;
		}
		out.preferences.soundEnabled = p.soundEnabled === undefined ? true : Boolean(p.soundEnabled);
		const fps = Number(p.fpslimit);
		if (VALID_FPS_LIMITS.has(fps)) {
			out.preferences.fpslimit = fps;
		}
		out.preferences.showCursor = p.showCursor === undefined ? true : Boolean(p.showCursor);
	}

	if (input.windowBounds && typeof input.windowBounds === 'object') {
		const wb = input.windowBounds;
		const w = Number(wb.width);
		const h = Number(wb.height);
		if (Number.isInteger(w) && w >= 800 && w <= 7680) {
			out.windowBounds.width = w;
		}
		if (Number.isInteger(h) && h >= 600 && h <= 4320) {
			out.windowBounds.height = h;
		}
		out.windowBounds.x = Number.isInteger(wb.x) ? wb.x : null;
		out.windowBounds.y = Number.isInteger(wb.y) ? wb.y : null;
		out.windowBounds.maximized = Boolean(wb.maximized);
	}

	if (input.updates && typeof input.updates === 'object') {
		out.updates.channel = input.updates.channel === 'beta' ? 'beta' : 'stable';
		out.updates.appFeedUrl = validateOptionalHttpUrl(input.updates.appFeedUrl).replace(/\/$/, '');
		out.updates.assetManifestUrl = validateOptionalHttpUrl(input.updates.assetManifestUrl).replace(/\/$/, '');
	}

	out.debugLogging = Boolean(input.debugLogging);
	return out;
}

export class SettingsStore {
	constructor(filePath) {
		this._filePath = filePath;
		this._data = createDefaultSettings();
	}

	load() {
		try {
			if (fs.existsSync(this._filePath)) {
				const raw = fs.readFileSync(this._filePath, 'utf8');
				const parsed = JSON.parse(raw);
				this._data = normalizeSettings(parsed);
				return this.get();
			}
		} catch {
			// Fall back safely to defaults if settings file is corrupted
		}
		this._data = createDefaultSettings();
		return this.get();
	}

	get() {
		return structuredClone(this._data);
	}

	save(nextPartial) {
		const merged =
			nextPartial && typeof nextPartial === 'object'
				? {
						...this._data,
						...nextPartial,
						assets: { ...this._data.assets, ...(nextPartial.assets || {}) },
						launcher: { ...this._data.launcher, ...(nextPartial.launcher || {}) },
						preferences: { ...this._data.preferences, ...(nextPartial.preferences || {}) },
						windowBounds: { ...this._data.windowBounds, ...(nextPartial.windowBounds || {}) },
						updates: { ...this._data.updates, ...(nextPartial.updates || {}) }
					}
				: this._data;

		this._data = normalizeSettings(merged);
		this._writeAtomic(this._data);
		return this.get();
	}

	reset() {
		this._data = createDefaultSettings();
		this._writeAtomic(this._data);
		return this.get();
	}

	getSanitizedForDiagnostics() {
		return sanitizeValue(this.get());
	}

	_writeAtomic(data) {
		const dir = path.dirname(this._filePath);
		fs.mkdirSync(dir, { recursive: true });
		const tmpPath = `${this._filePath}.${process.pid}.${Date.now()}.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
		fs.renameSync(tmpPath, this._filePath);
	}
}
