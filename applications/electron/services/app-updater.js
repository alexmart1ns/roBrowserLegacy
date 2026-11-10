import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
	DEFAULT_PATCHER_PUBLIC_KEY_PEM,
	sanitizeManifestRelativePath,
	validatePatchHttpUrl
} from './manifest-patcher.js';

export const APP_FEED_SCHEMA_VERSION = 1;
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024; // 512 MiB cap

export function parseSemver(rawVersion) {
	if (typeof rawVersion !== 'string') {
		return null;
	}
	const trimmed = rawVersion.trim().replace(/^v/i, '');
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed);
	if (!match) {
		return null;
	}
	return {
		major: Number.parseInt(match[1], 10),
		minor: Number.parseInt(match[2], 10),
		patch: Number.parseInt(match[3], 10),
		pre: match[4] || ''
	};
}

export function compareSemver(a, b) {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) {
		return 0;
	}
	if (pa.major !== pb.major) {
		return pa.major > pb.major ? 1 : -1;
	}
	if (pa.minor !== pb.minor) {
		return pa.minor > pb.minor ? 1 : -1;
	}
	if (pa.patch !== pb.patch) {
		return pa.patch > pb.patch ? 1 : -1;
	}
	if (!pa.pre && pb.pre) {
		return 1;
	}
	if (pa.pre && !pb.pre) {
		return -1;
	}
	if (pa.pre === pb.pre) {
		return 0;
	}
	return pa.pre > pb.pre ? 1 : -1;
}

export function canonicalizeAppFeedPayload(feed) {
	return JSON.stringify({
		feedVersion: feed.feedVersion,
		channel: feed.channel,
		version: String(feed.version || '').trim(),
		artifactName: path.basename(String(feed.artifactName || '')),
		sha256: String(feed.sha256 || '').toLowerCase(),
		size: Number(feed.size)
	});
}

export function signAppFeedPayload(feedBody, privateKeyPem) {
	const canonical = canonicalizeAppFeedPayload(feedBody);
	return crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem).toString('base64');
}

export function verifyAppFeedSignature(feed, publicKeys = [DEFAULT_PATCHER_PUBLIC_KEY_PEM]) {
	if (!feed || typeof feed !== 'object' || typeof feed.signature !== 'string' || !feed.signature) {
		return false;
	}
	const keys = Array.isArray(publicKeys) && publicKeys.length > 0 ? publicKeys : [DEFAULT_PATCHER_PUBLIC_KEY_PEM];
	const canonical = canonicalizeAppFeedPayload(feed);
	let sigBuf;
	try {
		sigBuf = Buffer.from(feed.signature, 'base64');
	} catch {
		return false;
	}
	for (const keyPem of keys) {
		try {
			if (crypto.verify(null, Buffer.from(canonical, 'utf8'), keyPem, sigBuf)) {
				return true;
			}
		} catch {
			// Next key
		}
	}
	return false;
}

export function resolveChannelFeedUrl(baseFeedUrl, channel = 'stable') {
	const cleanChannel = channel === 'beta' ? 'beta' : 'stable';
	const check = validatePatchHttpUrl(baseFeedUrl);
	if (!check.ok) {
		return { ok: false, reason: check.reason };
	}
	const href = check.url.toString();
	if (href.endsWith('.json')) {
		return { ok: true, url: href, origin: check.url.origin };
	}
	const normalized = href.endsWith('/') ? href : `${href}/`;
	const resolved = new URL(`${cleanChannel}.json`, normalized);
	return { ok: true, url: resolved.toString(), origin: check.url.origin };
}

export class AppUpdaterService {
	constructor({
		currentVersion,
		updatesDir,
		publicKeys = [DEFAULT_PATCHER_PUBLIC_KEY_PEM],
		fetchImpl = globalThis.fetch,
		onStatus = null
	} = {}) {
		this._currentVersion = currentVersion || '0.0.0';
		this._updatesDir = path.resolve(updatesDir);
		this._publicKeys = publicKeys;
		this._fetch = fetchImpl;
		this._onStatus = onStatus;
		this._gameplayActive = false;
		this._pendingUpdate = null; // { version, installerPath, sha256, releaseNotes }
		this._latestFeed = null;
	}

	setGameplayActive(active) {
		this._gameplayActive = Boolean(active);
	}

	isGameplayActive() {
		return this._gameplayActive;
	}

	getStatus() {
		return {
			currentVersion: this._currentVersion,
			gameplayActive: this._gameplayActive,
			availableVersion: this._latestFeed?.version || null,
			releaseNotes: this._latestFeed?.releaseNotes || '',
			downloadedInstallerPath: this._pendingUpdate?.installerPath || null,
			downloadedVersion: this._pendingUpdate?.version || null
		};
	}

	async checkForUpdates({ feedUrl, channel = 'stable' } = {}) {
		const resolvedFeed = resolveChannelFeedUrl(feedUrl, channel);
		if (!resolvedFeed.ok) {
			return { ok: false, code: resolvedFeed.reason };
		}

		let resp;
		try {
			resp = await this._fetch(resolvedFeed.url, {
				method: 'GET',
				headers: { Accept: 'application/json' },
				redirect: 'error'
			});
		} catch (err) {
			return { ok: false, code: 'NETWORK_ERROR', error: err?.message || 'Failed to contact update feed' };
		}

		if (!resp.ok) {
			return { ok: false, code: `HTTP_${resp.status}` };
		}

		let feed;
		try {
			feed = await resp.json();
		} catch {
			return { ok: false, code: 'INVALID_FEED_JSON' };
		}

		if (!feed || feed.feedVersion !== APP_FEED_SCHEMA_VERSION) {
			return { ok: false, code: 'UNSUPPORTED_FEED_VERSION' };
		}
		const cleanChannel = channel === 'beta' ? 'beta' : 'stable';
		if (feed.channel !== cleanChannel) {
			return { ok: false, code: 'CHANNEL_MISMATCH' };
		}
		if (!parseSemver(feed.version)) {
			return { ok: false, code: 'INVALID_VERSION' };
		}
		const safeName = sanitizeManifestRelativePath(path.basename(String(feed.artifactName || '')));
		if (!safeName || !/^[0-9a-f]{64}$/i.test(String(feed.sha256 || ''))) {
			return { ok: false, code: 'INVALID_ARTIFACT_METADATA' };
		}
		const size = Number(feed.size);
		if (!Number.isInteger(size) || size <= 0 || size > MAX_INSTALLER_BYTES) {
			return { ok: false, code: 'INVALID_ARTIFACT_SIZE' };
		}
		if (!verifyAppFeedSignature(feed, this._publicKeys)) {
			return { ok: false, code: 'BAD_FEED_SIGNATURE' };
		}

		let artifactUrl;
		try {
			const candidate = new URL(feed.artifactUrl || safeName, resolvedFeed.url);
			if (candidate.origin !== resolvedFeed.origin) {
				return { ok: false, code: 'CROSS_ORIGIN_ARTIFACT_DENIED' };
			}
			const checkUrl = validatePatchHttpUrl(candidate.toString());
			if (!checkUrl.ok) {
				return { ok: false, code: checkUrl.reason };
			}
			artifactUrl = checkUrl.url.toString();
		} catch {
			return { ok: false, code: 'INVALID_ARTIFACT_URL' };
		}

		const cmp = compareSemver(feed.version, this._currentVersion);
		if (cmp <= 0) {
			this._latestFeed = null;
			return {
				ok: true,
				updateAvailable: false,
				currentVersion: this._currentVersion,
				latestVersion: feed.version
			};
		}

		this._latestFeed = {
			version: feed.version,
			channel: cleanChannel,
			artifactName: safeName,
			artifactUrl,
			sha256: feed.sha256.toLowerCase(),
			size,
			releaseNotes: typeof feed.releaseNotes === 'string' ? feed.releaseNotes.slice(0, 2000) : ''
		};

		return {
			ok: true,
			updateAvailable: true,
			currentVersion: this._currentVersion,
			update: { ...this._latestFeed }
		};
	}

	async downloadAvailableUpdate() {
		if (!this._latestFeed) {
			return { ok: false, code: 'NO_UPDATE_AVAILABLE' };
		}
		const target = this._latestFeed;

		await fs.promises.mkdir(this._updatesDir, { recursive: true });
		const finalPath = path.join(this._updatesDir, target.artifactName);
		const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;

		let resp;
		try {
			resp = await this._fetch(target.artifactUrl, { method: 'GET', redirect: 'error' });
		} catch (err) {
			return { ok: false, code: 'DOWNLOAD_NETWORK_ERROR', error: err?.message || 'Download error' };
		}
		if (!resp.ok || !resp.body) {
			return { ok: false, code: `HTTP_${resp.status}` };
		}

		const hasher = crypto.createHash('sha256');
		let receivedBytes = 0;
		const fh = await fs.promises.open(tmpPath, 'w');
		try {
			const reader = resp.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				if (value && value.byteLength > 0) {
					receivedBytes += value.byteLength;
					if (receivedBytes > target.size) {
						throw Object.assign(new Error('Installer exceeds declared size'), { code: 'SIZE_MISMATCH' });
					}
					hasher.update(value);
					await fh.write(value);
				}
			}
			await fh.close();

			if (receivedBytes !== target.size) {
				throw Object.assign(new Error('Incomplete installer download'), { code: 'INCOMPLETE_DOWNLOAD' });
			}
			const digest = hasher.digest('hex');
			if (digest !== target.sha256) {
				throw Object.assign(new Error('Installer SHA-256 verification failed'), { code: 'HASH_MISMATCH' });
			}

			await fs.promises.rename(tmpPath, finalPath);
			this._pendingUpdate = {
				version: target.version,
				installerPath: finalPath,
				sha256: digest,
				releaseNotes: target.releaseNotes
			};
			if (this._onStatus) {
				this._onStatus(this.getStatus());
			}
			return {
				ok: true,
				version: target.version,
				installerPath: finalPath,
				deferredForGameplay: this._gameplayActive
			};
		} catch (err) {
			await fh.close().catch(() => {});
			await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
			return {
				ok: false,
				code: err?.code || 'DOWNLOAD_FAILED',
				error: err?.message || 'Download failed'
			};
		}
	}

	async prepareInstall() {
		if (!this._pendingUpdate || !fs.existsSync(this._pendingUpdate.installerPath)) {
			return { ok: false, code: 'NO_STAGED_UPDATE' };
		}
		if (this._gameplayActive) {
			return {
				ok: false,
				code: 'DEFERRED_UNTIL_RESTART',
				version: this._pendingUpdate.version
			};
		}
		return {
			ok: true,
			version: this._pendingUpdate.version,
			installerPath: this._pendingUpdate.installerPath
		};
	}
}
