import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_MANIFEST_FILES = 5000;
export const MAX_ASSET_PATCH_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB safety limit per file

// Default production Ed25519 trust anchor (corresponding private key kept offline/CI only).
export const DEFAULT_PATCHER_PUBLIC_KEY_PEM = [
	'-----BEGIN PUBLIC KEY-----',
	'MCowBQYDK2VwAyEA166c3ZqkQPnRizN4F9MqDPGMo+BzGV/nge7kL6DC3AI=',
	'-----END PUBLIC KEY-----'
].join('\n');

function isBlockedRemoteIp(hostname) {
	const cleaned = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	const ipVer = net.isIP(cleaned);
	if (!ipVer) {
		return false;
	}
	if (ipVer === 4) {
		const parts = cleaned.split('.').map(Number);
		const [a, b] = parts;
		if (a === 0) {
			return true; // 0.0.0.0/8
		}
		if (a === 169 && b === 254) {
			return true; // Link-local / cloud metadata
		}
		if (a >= 224) {
			return true; // Multicast / reserved
		}
		return false;
	}
	if (cleaned.startsWith('fe80:') || cleaned.startsWith('ff') || cleaned === '::') {
		return true;
	}
	return false;
}

export function validatePatchHttpUrl(rawUrl, { allowHttp = true } = {}) {
	if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
		return { ok: false, reason: 'EMPTY_URL' };
	}
	let parsed;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		return { ok: false, reason: 'INVALID_URL' };
	}
	if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
		return { ok: false, reason: 'DISALLOWED_PROTOCOL' };
	}
	if (parsed.username || parsed.password) {
		return { ok: false, reason: 'CREDENTIALS_DISALLOWED' };
	}
	if (isBlockedRemoteIp(parsed.hostname)) {
		return { ok: false, reason: 'BLOCKED_IP_HOST' };
	}
	return { ok: true, url: parsed };
}

export function sanitizeManifestRelativePath(rawRelPath) {
	if (typeof rawRelPath !== 'string' || !rawRelPath.trim()) {
		return null;
	}
	const trimmed = rawRelPath.trim();
	if (/[\0\r\n]/.test(trimmed) || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('\\\\')) {
		return null;
	}
	const unified = trimmed.replace(/\\/g, '/');
	if (unified.startsWith('/') || path.posix.isAbsolute(unified)) {
		return null;
	}
	const segments = unified.split('/');
	if (segments.some(seg => seg === '' || seg === '.' || seg === '..')) {
		return null;
	}
	return segments.join('/');
}

export function canonicalizeManifestPayload(manifest) {
	const sortedFiles = [...(manifest.files || [])]
		.map(entry => ({
			path: sanitizeManifestRelativePath(entry.path),
			sha256: String(entry.sha256 || '').toLowerCase(),
			size: Number(entry.size)
		}))
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

	return JSON.stringify({
		manifestVersion: manifest.manifestVersion,
		generation: manifest.generation,
		channel: manifest.channel,
		files: sortedFiles
	});
}

export function signManifestPayload(manifestBody, privateKeyPem) {
	const canonical = canonicalizeManifestPayload(manifestBody);
	const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem);
	return sig.toString('base64');
}

export function verifyManifestSignature(manifest, publicKeys = [DEFAULT_PATCHER_PUBLIC_KEY_PEM]) {
	if (!manifest || typeof manifest !== 'object' || typeof manifest.signature !== 'string' || !manifest.signature) {
		return false;
	}
	const keys = Array.isArray(publicKeys) && publicKeys.length > 0 ? publicKeys : [DEFAULT_PATCHER_PUBLIC_KEY_PEM];
	const canonical = canonicalizeManifestPayload(manifest);
	let sigBuf;
	try {
		sigBuf = Buffer.from(manifest.signature, 'base64');
	} catch {
		return false;
	}
	if (sigBuf.length === 0) {
		return false;
	}
	for (const keyPem of keys) {
		try {
			if (crypto.verify(null, Buffer.from(canonical, 'utf8'), keyPem, sigBuf)) {
				return true;
			}
		} catch {
			// Try next key
		}
	}
	return false;
}

export function validateManifestStructure(manifest, { manifestUrl = null, expectedChannel = null } = {}) {
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		return { ok: false, reason: 'INVALID_MANIFEST_OBJECT' };
	}
	if (manifest.manifestVersion !== MANIFEST_SCHEMA_VERSION) {
		return { ok: false, reason: 'UNSUPPORTED_MANIFEST_VERSION' };
	}
	if (!Number.isInteger(manifest.generation) || manifest.generation < 1) {
		return { ok: false, reason: 'INVALID_GENERATION' };
	}
	const channel = manifest.channel === 'beta' ? 'beta' : manifest.channel === 'stable' ? 'stable' : null;
	if (!channel) {
		return { ok: false, reason: 'INVALID_CHANNEL' };
	}
	if (expectedChannel && channel !== expectedChannel) {
		return { ok: false, reason: 'CHANNEL_MISMATCH' };
	}
	if (!Array.isArray(manifest.files) || manifest.files.length > MAX_MANIFEST_FILES) {
		return { ok: false, reason: 'INVALID_FILES_LIST' };
	}

	let baseResolved = null;
	if (manifest.baseUrl) {
		const baseCheck = validatePatchHttpUrl(manifest.baseUrl);
		if (!baseCheck.ok) {
			return { ok: false, reason: 'INVALID_BASE_URL' };
		}
		baseResolved = baseCheck.url;
	} else if (manifestUrl) {
		const urlCheck = validatePatchHttpUrl(manifestUrl);
		if (!urlCheck.ok) {
			return { ok: false, reason: 'INVALID_MANIFEST_URL' };
		}
		baseResolved = urlCheck.url;
	}

	const normalizedFiles = [];
	const seenPaths = new Set();

	for (const item of manifest.files) {
		if (!item || typeof item !== 'object') {
			return { ok: false, reason: 'INVALID_FILE_ENTRY' };
		}
		const relPath = sanitizeManifestRelativePath(item.path);
		if (!relPath || seenPaths.has(relPath.toLowerCase())) {
			return { ok: false, reason: 'UNSAFE_OR_DUPLICATE_PATH' };
		}
		seenPaths.add(relPath.toLowerCase());

		const sha256 = typeof item.sha256 === 'string' ? item.sha256.trim().toLowerCase() : '';
		if (!/^[0-9a-f]{64}$/.test(sha256)) {
			return { ok: false, reason: 'INVALID_FILE_SHA256' };
		}

		const size = Number(item.size);
		if (!Number.isInteger(size) || size < 0 || size > MAX_ASSET_PATCH_BYTES) {
			return { ok: false, reason: 'INVALID_FILE_SIZE' };
		}

		let resolvedUrl = null;
		const urlInput = item.url || relPath;
		if (baseResolved) {
			try {
				const candidate = new URL(urlInput, baseResolved);
				if (candidate.origin !== baseResolved.origin) {
					return { ok: false, reason: 'CROSS_ORIGIN_FILE_URL' };
				}
				const urlCheck = validatePatchHttpUrl(candidate.toString());
				if (!urlCheck.ok) {
					return { ok: false, reason: urlCheck.reason };
				}
				resolvedUrl = candidate.toString();
			} catch {
				return { ok: false, reason: 'INVALID_ENTRY_URL' };
			}
		}

		normalizedFiles.push({
			path: relPath,
			sha256,
			size,
			url: resolvedUrl
		});
	}

	return {
		ok: true,
		manifest: {
			manifestVersion: manifest.manifestVersion,
			generation: manifest.generation,
			channel,
			files: normalizedFiles
		}
	};
}

async function computeFileSha256(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('error', reject);
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

function isInsideRealDir(rootReal, targetReal) {
	if (targetReal === rootReal) {
		return true;
	}
	const rel = path.relative(rootReal, targetReal);
	return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function ensureDirectoryWritable(dirPath) {
	await fs.promises.mkdir(dirPath, { recursive: true });
	const probePath = path.join(dirPath, `.write-probe-${process.pid}-${Date.now()}`);
	const fh = await fs.promises.open(probePath, 'w');
	await fh.close();
	await fs.promises.rm(probePath, { force: true });
}

export class ManifestPatcher {
	constructor({
		managedDir,
		publicKeys = [DEFAULT_PATCHER_PUBLIC_KEY_PEM],
		fetchImpl = globalThis.fetch,
		beforeApply = null,
		afterApply = null,
		onProgress = null,
		concurrency = 3
	} = {}) {
		if (!managedDir) {
			throw new Error('ManifestPatcher requires a managedDir path');
		}
		this._managedDir = path.resolve(managedDir);
		this._statePath = path.join(this._managedDir, 'patch-state.json');
		this._publicKeys = publicKeys;
		this._fetch = fetchImpl;
		this._beforeApply = beforeApply;
		this._afterApply = afterApply;
		this._onProgress = onProgress;
		this._concurrency = Math.max(1, Math.min(6, concurrency));
		this._activeController = null;
	}

	getManagedDir() {
		return this._managedDir;
	}

	readState() {
		try {
			if (fs.existsSync(this._statePath)) {
				const parsed = JSON.parse(fs.readFileSync(this._statePath, 'utf8'));
				return {
					generation: Number.isInteger(parsed?.generation) ? parsed.generation : 0,
					channel: parsed?.channel === 'beta' ? 'beta' : 'stable',
					lastAppliedAt: parsed?.lastAppliedAt || null,
					fileCount: Number.isInteger(parsed?.fileCount) ? parsed.fileCount : 0
				};
			}
		} catch {
			// Fall back to empty initial patch state
		}
		return {
			generation: 0,
			channel: 'stable',
			lastAppliedAt: null,
			fileCount: 0
		};
	}

	cancelActive() {
		if (this._activeController) {
			this._activeController.abort(new Error('PATCH_CANCELED'));
		}
	}

	async fetchAndVerifyManifest(manifestUrl, { channel = null } = {}) {
		const urlCheck = validatePatchHttpUrl(manifestUrl);
		if (!urlCheck.ok) {
			return { ok: false, code: urlCheck.reason };
		}

		const resp = await this._fetch(urlCheck.url.toString(), {
			method: 'GET',
			headers: { Accept: 'application/json' },
			redirect: 'error'
		});
		if (!resp.ok) {
			return { ok: false, code: `HTTP_${resp.status}` };
		}
		const rawManifest = await resp.json();
		const checked = this.verifyManifestObject(rawManifest, {
			manifestUrl: urlCheck.url.toString(),
			expectedChannel: channel
		});
		return checked.ok ? { ...checked, rawManifest } : checked;
	}

	async applyFromUrl(manifestUrl, { channel = null } = {}) {
		const checked = await this.fetchAndVerifyManifest(manifestUrl, { channel });
		if (!checked.ok) {
			return checked;
		}
		if (!checked.updateAvailable) {
			return {
				ok: true,
				upToDate: true,
				generation: checked.currentGeneration
			};
		}
		return this.applyManifest(checked.rawManifest, {
			manifestUrl,
			expectedChannel: channel
		});
	}

	verifyManifestObject(rawManifest, { manifestUrl = null, expectedChannel = null } = {}) {
		const struct = validateManifestStructure(rawManifest, { manifestUrl, expectedChannel });
		if (!struct.ok) {
			return { ok: false, code: struct.reason };
		}
		if (!verifyManifestSignature(rawManifest, this._publicKeys)) {
			return { ok: false, code: 'BAD_MANIFEST_SIGNATURE' };
		}

		const currentState = this.readState();
		if (struct.manifest.generation < currentState.generation) {
			return {
				ok: false,
				code: 'DOWNGRADE_REJECTED',
				currentGeneration: currentState.generation,
				manifestGeneration: struct.manifest.generation
			};
		}

		return {
			ok: true,
			manifest: struct.manifest,
			currentGeneration: currentState.generation,
			updateAvailable: struct.manifest.generation > currentState.generation
		};
	}

	async applyManifest(rawManifest, { manifestUrl = null, expectedChannel = null, swapHookForTest = null } = {}) {
		const check = this.verifyManifestObject(rawManifest, { manifestUrl, expectedChannel });
		if (!check.ok) {
			return check;
		}

		const { manifest } = check;
		try {
			await ensureDirectoryWritable(this._managedDir);
		} catch (err) {
			return {
				ok: false,
				code: 'DIRECTORY_NOT_WRITABLE',
				error: err?.message || 'Permission denied'
			};
		}

		const managedReal = await fs.promises.realpath(this._managedDir);
		const workId = `${process.pid}-${Date.now()}`;
		const stagingDir = path.join(managedReal, `.patch-staging-${workId}`);
		const backupDir = path.join(managedReal, `.patch-backup-${workId}`);
		await fs.promises.mkdir(stagingDir, { recursive: true });
		await fs.promises.mkdir(backupDir, { recursive: true });

		this._activeController = new AbortController();
		const { signal } = this._activeController;

		try {
			// Identify files that actually need download/verification
			const pendingEntries = [];
			for (const entry of manifest.files) {
				const destPath = path.resolve(managedReal, entry.path);
				const relCheck = path.relative(managedReal, destPath);
				if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
					throw Object.assign(new Error('Unsafe target path'), { code: 'UNSAFE_TARGET_PATH' });
				}

				if (fs.existsSync(destPath)) {
					const st = await fs.promises.lstat(destPath);
					if (st.isSymbolicLink()) {
						throw Object.assign(new Error('Target is a symlink'), { code: 'SYMLINK_TARGET_DENIED' });
					}
					const realDest = await fs.promises.realpath(destPath);
					if (!isInsideRealDir(managedReal, realDest)) {
						throw Object.assign(new Error('Target escaped root'), { code: 'UNSAFE_TARGET_PATH' });
					}
					if (st.isFile() && st.size === entry.size) {
						const existingHash = await computeFileSha256(realDest);
						if (existingHash === entry.sha256) {
							continue;
						}
					}
				}

				if (!entry.url) {
					throw Object.assign(new Error(`Missing download URL for ${entry.path}`), {
						code: 'MISSING_DOWNLOAD_URL'
					});
				}

				pendingEntries.push({
					...entry,
					destPath,
					stagePath: path.join(stagingDir, entry.path),
					backupPath: path.join(backupDir, entry.path)
				});
			}

			// Download with bounded concurrency
			let completed = 0;
			const totalToDownload = pendingEntries.length;
			const queue = pendingEntries.slice();

			const runWorker = async () => {
				while (queue.length > 0) {
					if (signal.aborted) {
						throw Object.assign(new Error('Patch canceled'), { code: 'PATCH_CANCELED' });
					}
					const item = queue.shift();
					await this._downloadAndVerifyEntry(item, signal);
					completed++;
					if (this._onProgress) {
						this._onProgress({
							stage: 'downloading',
							completed,
							total: totalToDownload,
							file: item.path
						});
					}
				}
			};

			const workers = Array.from(
				{ length: Math.min(this._concurrency, Math.max(1, pendingEntries.length)) },
				() => runWorker()
			);
			await Promise.all(workers);

			// Release VFS worker file handles before swapping files
			if (this._beforeApply) {
				await this._beforeApply();
			}

			// Transactional swap with rollback journal
			const journal = [];
			try {
				for (let idx = 0; idx < pendingEntries.length; idx++) {
					const item = pendingEntries[idx];
					if (swapHookForTest) {
						await swapHookForTest(item, idx);
					}
					await fs.promises.mkdir(path.dirname(item.destPath), { recursive: true });
					const hadPrevious = fs.existsSync(item.destPath);
					if (hadPrevious) {
						await fs.promises.mkdir(path.dirname(item.backupPath), { recursive: true });
						await fs.promises.rename(item.destPath, item.backupPath);
					}
					journal.push({ destPath: item.destPath, backupPath: item.backupPath, hadPrevious });
					await fs.promises.rename(item.stagePath, item.destPath);
				}

				const statePayload = {
					generation: manifest.generation,
					channel: manifest.channel,
					lastAppliedAt: new Date().toISOString(),
					fileCount: manifest.files.length
				};
				const tmpState = path.join(stagingDir, 'patch-state.json.tmp');
				await fs.promises.writeFile(tmpState, JSON.stringify(statePayload, null, 2), 'utf8');
				await fs.promises.rename(tmpState, this._statePath);

				if (this._onProgress) {
					this._onProgress({ stage: 'completed', completed: totalToDownload, total: totalToDownload });
				}

				return {
					ok: true,
					generation: manifest.generation,
					downloadedCount: pendingEntries.length,
					totalFiles: manifest.files.length
				};
			} catch (swapErr) {
				// Rollback already-swapped files in reverse order
				for (let i = journal.length - 1; i >= 0; i--) {
					const j = journal[i];
					await fs.promises.rm(j.destPath, { force: true }).catch(() => {});
					if (j.hadPrevious && fs.existsSync(j.backupPath)) {
						await fs.promises.rename(j.backupPath, j.destPath).catch(() => {});
					}
				}
				return {
					ok: false,
					code: swapErr?.code || 'ATOMIC_SWAP_FAILED',
					rolledBack: true,
					error: swapErr?.message || 'Atomic swap failed'
				};
			} finally {
				if (this._afterApply) {
					await this._afterApply().catch(() => {});
				}
			}
		} catch (err) {
			return {
				ok: false,
				code: signal.aborted ? 'PATCH_CANCELED' : err?.code || 'PATCH_FAILED',
				error: err?.message || 'Patch failed'
			};
		} finally {
			this._activeController = null;
			await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
			await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {});
		}
	}

	async _downloadAndVerifyEntry(entry, signal) {
		const resp = await this._fetch(entry.url, { method: 'GET', signal, redirect: 'error' });
		if (!resp.ok || !resp.body) {
			throw Object.assign(new Error(`HTTP ${resp.status} fetching ${entry.path}`), {
				code: resp.status === 404 ? 'MISSING_REMOTE_FILE' : 'DOWNLOAD_HTTP_ERROR'
			});
		}

		await fs.promises.mkdir(path.dirname(entry.stagePath), { recursive: true });
		const hasher = crypto.createHash('sha256');
		const fh = await fs.promises.open(entry.stagePath, 'w');
		let receivedBytes = 0;

		try {
			const reader = resp.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				if (value && value.byteLength > 0) {
					receivedBytes += value.byteLength;
					if (receivedBytes > entry.size) {
						throw Object.assign(new Error(`Size overflow for ${entry.path}`), {
							code: 'SIZE_MISMATCH'
						});
					}
					hasher.update(value);
					await fh.write(value);
				}
			}
		} finally {
			await fh.close().catch(() => {});
		}

		if (receivedBytes !== entry.size) {
			throw Object.assign(
				new Error(`Incomplete download for ${entry.path}: got ${receivedBytes} expected ${entry.size}`),
				{ code: 'INCOMPLETE_DOWNLOAD' }
			);
		}

		const actualSha = hasher.digest('hex');
		if (actualSha !== entry.sha256) {
			throw Object.assign(new Error(`Checksum mismatch for ${entry.path}`), { code: 'HASH_MISMATCH' });
		}
	}
}
