import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY_PATTERN = /^(?:pass(?:wd|word)?|token|auth|secret|cookie|session|credential|privateKey|apiKey)$/i;
const MAX_RING_ENTRIES = 500;
const MAX_LOG_FILE_BYTES = 2 * 1024 * 1024;

export function sanitizeValue(value, depth = 0) {
	if (depth > 5 || value === null || value === undefined) {
		return value;
	}
	if (typeof value === 'string') {
		return value.length > 1000 ? `${value.slice(0, 1000)}…[truncated]` : value;
	}
	if (typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1));
	}
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		if (SENSITIVE_KEY_PATTERN.test(k)) {
			out[k] = '[REDACTED]';
		} else {
			out[k] = sanitizeValue(v, depth + 1);
		}
	}
	return out;
}

export class DesktopLogger {
	constructor({ logDir = null, debugEnabled = false } = {}) {
		this._logDir = logDir;
		this._debugEnabled = Boolean(debugEnabled);
		this._entries = [];
	}

	setDebugEnabled(enabled) {
		this._debugEnabled = Boolean(enabled);
	}

	isDebugEnabled() {
		return this._debugEnabled;
	}

	log(level, category, message, meta = null) {
		if (level === 'debug' && !this._debugEnabled) {
			return;
		}
		const entry = {
			ts: new Date().toISOString(),
			level,
			category: String(category || 'app'),
			message: String(message || ''),
			...(meta ? { meta: sanitizeValue(meta) } : {})
		};

		this._entries.push(entry);
		if (this._entries.length > MAX_RING_ENTRIES) {
			this._entries.shift();
		}

		if (this._debugEnabled && this._logDir) {
			this._appendToFile(entry);
		}
	}

	info(category, message, meta) {
		this.log('info', category, message, meta);
	}

	warn(category, message, meta) {
		this.log('warn', category, message, meta);
	}

	error(category, message, meta) {
		this.log('error', category, message, meta);
	}

	debug(category, message, meta) {
		this.log('debug', category, message, meta);
	}

	getEntries() {
		return this._entries.slice();
	}

	_appendToFile(entry) {
		try {
			fs.mkdirSync(this._logDir, { recursive: true });
			const logFile = path.join(this._logDir, 'desktop.log');
			if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_FILE_BYTES) {
				const rotated = path.join(this._logDir, 'desktop.log.1');
				fs.rmSync(rotated, { force: true });
				fs.renameSync(logFile, rotated);
			}
			fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`, 'utf8');
		} catch {
			// Do not crash on log write errors
		}
	}
}
