import fs from 'node:fs';
import path from 'node:path';
import {
	detectPePacketVerFromFile,
	normalizeAssetKey,
	parseDataIni,
	parseGrfIndexFromHandle,
	readAndDecodeGrfEntry
} from './grf-reader.js';
import { clearAllCachedGrfIndices, loadCachedGrfIndex, saveCachedGrfIndex } from './asset-index-cache.js';

const LOOSE_TOP_DIRS = new Set(['data', 'bgm', 'system', 'ai']);
const MAX_LOOSE_FILE_BYTES = 256 * 1024 * 1024;

function isInsideRealRoot(rootRealPath, targetRealPath) {
	if (targetRealPath === rootRealPath) {
		return true;
	}
	const rel = path.relative(rootRealPath, targetRealPath);
	return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export class LocalAssetVfs {
	constructor({ cacheDir = null, onProgress = null } = {}) {
		this._cacheDir = cacheDir;
		this._onProgress = onProgress;
		this._rootDir = null;
		this._rootRealPath = null;
		this._looseFiles = new Map(); // normalizedKey -> { realPath, displayName, size }
		this._grfMounts = []; // ordered by priority (0 = highest)
		this._conflicts = [];
		this._missingGrfs = [];
		this._detectedPacketVer = null;
		this._stats = {
			configured: false,
			rootDir: null,
			looseCount: 0,
			grfCount: 0,
			totalGrfEntries: 0,
			indexCacheHits: 0,
			indexCacheMisses: 0,
			lastIndexedAt: null,
			indexDurationMs: 0,
			detectedPacketVer: null
		};
	}

	async close() {
		for (const mount of this._grfMounts) {
			if (mount.fh) {
				try {
					await mount.fh.close();
				} catch {
					// Ignore already-closed handles
				}
				mount.fh = null;
			}
		}
		this._grfMounts = [];
		this._looseFiles.clear();
		this._conflicts = [];
		this._missingGrfs = [];
		this._rootDir = null;
		this._rootRealPath = null;
		this._detectedPacketVer = null;
		this._stats = {
			...this._stats,
			configured: false,
			rootDir: null,
			looseCount: 0,
			grfCount: 0,
			totalGrfEntries: 0,
			detectedPacketVer: null
		};
	}

	async invalidateCache() {
		await clearAllCachedGrfIndices(this._cacheDir);
	}

	async initializeDirectory(rootDir, { grfList = null, forceReindex = false } = {}) {
		const startMs = Date.now();
		await this.close();

		if (!rootDir || typeof rootDir !== 'string') {
			throw new Error('ASSET_INVALID_DIRECTORY');
		}

		const resolvedRoot = path.resolve(rootDir);
		const rootStat = await fs.promises.stat(resolvedRoot);
		if (!rootStat.isDirectory()) {
			throw new Error('ASSET_NOT_A_DIRECTORY');
		}
		const rootRealPath = await fs.promises.realpath(resolvedRoot);
		this._rootDir = resolvedRoot;
		this._rootRealPath = rootRealPath;

		if (forceReindex) {
			await this.invalidateCache();
		}

		this._emitProgress('scanning', 0, 'Scanning directory...');

		// 1. Scan top-level entries for DATA.INI, GRFs, RO executable, and loose asset folders
		const topEntries = await fs.promises.readdir(rootRealPath, { withFileTypes: true });
		let dataIniName = null;
		const discoveredGrfs = [];
		const exeCandidates = [];

		for (const entry of topEntries) {
			const lower = entry.name.toLowerCase();
			if (entry.isFile() || entry.isSymbolicLink()) {
				const full = path.join(rootRealPath, entry.name);
				let real;
				try {
					real = await fs.promises.realpath(full);
				} catch {
					continue;
				}
				if (!isInsideRealRoot(rootRealPath, real)) {
					continue;
				}
				const st = await fs.promises.stat(real);
				if (!st.isFile()) {
					continue;
				}
				if (lower === 'data.ini') {
					dataIniName = real;
				} else if (lower.endsWith('.grf')) {
					discoveredGrfs.push({ name: entry.name, realPath: real, size: st.size, mtimeMs: st.mtimeMs });
				} else if (lower.endsWith('.exe')) {
					exeCandidates.push({ name: entry.name, realPath: real, size: st.size });
				} else if (lower === 'clientinfo.xml') {
					const key = normalizeAssetKey('data/clientinfo.xml');
					if (key) {
						this._looseFiles.set(key, {
							realPath: real,
							displayName: 'data\\clientinfo.xml',
							size: st.size
						});
					}
				}
			}
		}

		// 2. Detect PACKETVER from RO executable if present (3-7 MB)
		for (const exe of exeCandidates) {
			try {
				const pv = await detectPePacketVerFromFile(exe.realPath, exe.size);
				if (pv) {
					this._detectedPacketVer = pv;
					break;
				}
			} catch {
				// Ignore invalid PE
			}
		}

		// 3. Index loose directories (data/, BGM/, System/, AI/)
		for (const entry of topEntries) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) {
				continue;
			}
			const lowerTop = entry.name.toLowerCase();
			if (!LOOSE_TOP_DIRS.has(lowerTop)) {
				continue;
			}
			const canonicalTop =
				lowerTop === 'bgm' ? 'BGM' : lowerTop === 'system' ? 'System' : lowerTop === 'ai' ? 'AI' : 'data';
			await this._scanLooseDir(path.join(rootRealPath, entry.name), canonicalTop);
		}

		// 4. Determine GRF priority order:
		//    explicit grfList > DATA.INI numeric order > discovered *.grf sorted by ascending size
		let orderedGrfPaths = [];
		let prioritySource = 'auto-size';

		if (Array.isArray(grfList) && grfList.length > 0) {
			prioritySource = 'config';
			orderedGrfPaths = grfList.map(item => String(item).trim()).filter(Boolean);
		} else if (dataIniName) {
			const iniRaw = await fs.promises.readFile(dataIniName, 'latin1');
			const iniGrfs = parseDataIni(iniRaw);
			if (iniGrfs.length > 0) {
				prioritySource = 'DATA.INI';
				orderedGrfPaths = iniGrfs;
			}
		}

		if (orderedGrfPaths.length === 0 && discoveredGrfs.length > 0) {
			discoveredGrfs.sort((a, b) => a.size - b.size);
			orderedGrfPaths = discoveredGrfs.map(g => g.name);
		}

		// 5. Open and index each GRF safely inside rootRealPath
		let cacheHits = 0;
		let cacheMisses = 0;
		let totalGrfEntries = 0;
		const seenFiles = new Set();

		for (let i = 0; i < orderedGrfPaths.length; i++) {
			const rawGrfName = orderedGrfPaths[i];
			const normalizedRel = rawGrfName.replace(/\\/g, '/').replace(/^\/+/, '');
			if (
				!normalizedRel ||
				path.isAbsolute(rawGrfName) ||
				/^[a-zA-Z]:/.test(rawGrfName) ||
				normalizedRel.split('/').some(seg => seg === '..')
			) {
				this._missingGrfs.push({ name: rawGrfName, reason: 'DISALLOWED_PATH' });
				continue;
			}

			const candidate = path.resolve(rootRealPath, normalizedRel);
			let realGrfPath;
			let st;
			try {
				realGrfPath = await fs.promises.realpath(candidate);
				if (!isInsideRealRoot(rootRealPath, realGrfPath)) {
					this._missingGrfs.push({ name: rawGrfName, reason: 'OUTSIDE_ROOT' });
					continue;
				}
				st = await fs.promises.stat(realGrfPath);
				if (!st.isFile()) {
					this._missingGrfs.push({ name: rawGrfName, reason: 'NOT_A_FILE' });
					continue;
				}
			} catch {
				this._missingGrfs.push({ name: rawGrfName, reason: 'NOT_FOUND' });
				continue;
			}

			if (seenFiles.has(realGrfPath)) {
				continue;
			}
			seenFiles.add(realGrfPath);

			this._emitProgress(
				'indexing',
				Math.round(((i + 0.5) / Math.max(1, orderedGrfPaths.length)) * 100),
				`Indexing ${path.basename(realGrfPath)}...`
			);

			const fh = await fs.promises.open(realGrfPath, 'r');
			try {
				let indexData = forceReindex ? null : await loadCachedGrfIndex(this._cacheDir, realGrfPath, st);
				if (indexData) {
					cacheHits++;
				} else {
					cacheMisses++;
					indexData = await parseGrfIndexFromHandle(fh, st.size);
					await saveCachedGrfIndex(this._cacheDir, realGrfPath, st, indexData);
				}

				totalGrfEntries += indexData.entries.length;
				this._grfMounts.push({
					priority: this._grfMounts.length,
					prioritySource,
					name: path.basename(realGrfPath),
					relativeName: rawGrfName,
					realPath: realGrfPath,
					size: st.size,
					mtimeMs: st.mtimeMs,
					fh,
					fromCache: Boolean(indexData.fromCache),
					version: indexData.version,
					entries: indexData.entries,
					entryMap: indexData.entryMap
				});
			} catch (err) {
				await fh.close().catch(() => {});
				this._missingGrfs.push({ name: rawGrfName, reason: err?.message || 'INVALID_GRF' });
			}
		}

		// Record override conflicts (informational diagnostics: loose files & higher-priority GRFs)
		for (const key of this._looseFiles.keys()) {
			for (const mount of this._grfMounts) {
				if (mount.entryMap.has(key)) {
					this._conflicts.push({ key, winner: 'loose', shadowedBy: mount.name });
					break;
				}
			}
		}

		const durationMs = Date.now() - startMs;
		this._stats = {
			configured: true,
			rootDir: rootRealPath,
			looseCount: this._looseFiles.size,
			grfCount: this._grfMounts.length,
			totalGrfEntries,
			indexCacheHits: cacheHits,
			indexCacheMisses: cacheMisses,
			lastIndexedAt: new Date().toISOString(),
			indexDurationMs: durationMs,
			detectedPacketVer: this._detectedPacketVer,
			missingGrfs: this._missingGrfs.slice(0, 20),
			conflictCount: this._conflicts.length
		};

		this._emitProgress('ready', 100, 'Assets indexed');
		return this.getStatus();
	}

	async _scanLooseDir(dirPath, relPrefix) {
		let realDir;
		try {
			realDir = await fs.promises.realpath(dirPath);
		} catch {
			return;
		}
		if (!isInsideRealRoot(this._rootRealPath, realDir)) {
			return;
		}

		let entries;
		try {
			entries = await fs.promises.readdir(realDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const childPath = path.join(realDir, entry.name);
			let realChild;
			try {
				realChild = await fs.promises.realpath(childPath);
			} catch {
				continue;
			}
			if (!isInsideRealRoot(this._rootRealPath, realChild)) {
				continue;
			}

			let st;
			try {
				st = await fs.promises.stat(realChild);
			} catch {
				continue;
			}

			const childRel = `${relPrefix}/${entry.name}`;
			if (st.isDirectory()) {
				await this._scanLooseDir(realChild, childRel);
			} else if (st.isFile() && st.size <= MAX_LOOSE_FILE_BYTES) {
				const key = normalizeAssetKey(childRel);
				if (key) {
					this._looseFiles.set(key, {
						realPath: realChild,
						displayName: childRel.replace(/\//g, '\\'),
						size: st.size
					});
				}
			}
		}
	}

	_emitProgress(stage, percent, message) {
		if (this._onProgress) {
			this._onProgress({ stage, percent, message });
		}
	}

	exists(rawPath) {
		const key = normalizeAssetKey(rawPath);
		if (!key) {
			return false;
		}
		if (this._looseFiles.has(key)) {
			return true;
		}
		for (const mount of this._grfMounts) {
			if (mount.entryMap.has(key)) {
				return true;
			}
		}
		return false;
	}

	async getFile(rawPath) {
		if (!this._stats.configured) {
			return { found: false, reason: 'NOT_CONFIGURED' };
		}
		const key = normalizeAssetKey(rawPath);
		if (!key) {
			return { found: false, reason: 'INVALID_PATH' };
		}

		// Priority 1: Loose local file
		const loose = this._looseFiles.get(key);
		if (loose) {
			if (!isInsideRealRoot(this._rootRealPath, loose.realPath)) {
				return { found: false, reason: 'FORBIDDEN_PATH' };
			}
			const buf = await fs.promises.readFile(loose.realPath);
			const bytes = new Uint8Array(buf.byteLength);
			bytes.set(buf);
			return { found: true, source: 'loose', bytes, size: bytes.byteLength };
		}

		// Priority 2: GRFs in DATA.INI / priority order
		for (const mount of this._grfMounts) {
			const rec = mount.entryMap.get(key);
			if (!rec) {
				continue;
			}
			try {
				const bytes = await readAndDecodeGrfEntry(mount.fh, mount.size, rec);
				if (bytes) {
					return { found: true, source: `grf:${mount.name}`, bytes, size: bytes.byteLength };
				}
			} catch (err) {
				return { found: false, reason: err?.message || 'DECODE_FAILED' };
			}
		}

		return { found: false, reason: 'NOT_FOUND' };
	}

	async getFileInfo(rawPath) {
		if (!this._stats.configured) {
			return { found: false };
		}
		const key = normalizeAssetKey(rawPath);
		if (!key) {
			return { found: false };
		}
		const loose = this._looseFiles.get(key);
		if (loose) {
			return { found: true, source: 'loose', realPath: loose.realPath, size: loose.size };
		}
		for (const mount of this._grfMounts) {
			const rec = mount.entryMap.get(key);
			if (rec) {
				return { found: true, source: `grf:${mount.name}`, size: rec[4] };
			}
		}
		return { found: false };
	}

	search(patternSource, patternFlags = '') {
		if (!this._stats.configured || typeof patternSource !== 'string' || patternSource.length > 512) {
			return [];
		}
		let regex;
		try {
			// Strip global/sticky flags so .test() doesn't maintain stateful lastIndex
			const safeFlags = String(patternFlags || '').replace(/[gy]/g, '');
			regex = new RegExp(patternSource, safeFlags);
		} catch {
			return [];
		}

		const seen = new Set();
		const out = [];

		for (const loose of this._looseFiles.values()) {
			if (regex.test(loose.displayName) && !seen.has(loose.displayName)) {
				seen.add(loose.displayName);
				out.push(loose.displayName);
			}
		}

		for (const mount of this._grfMounts) {
			for (const rec of mount.entries) {
				const displayName = rec[1];
				if (regex.test(displayName) && !seen.has(displayName)) {
					seen.add(displayName);
					out.push(displayName);
				}
			}
		}

		return out;
	}

	getPriority() {
		const list = [];
		if (this._stats.configured) {
			list.push({
				type: 'loose',
				name: 'Loose directories (data/, BGM/, System/, AI/)',
				priority: 0,
				count: this._looseFiles.size
			});
			for (const mount of this._grfMounts) {
				list.push({
					type: 'grf',
					name: mount.name,
					priority: mount.priority + 1,
					prioritySource: mount.prioritySource,
					entryCount: mount.entries.length,
					size: mount.size,
					fromCache: mount.fromCache
				});
			}
		}
		return list;
	}

	getStatus() {
		return {
			...this._stats,
			priority: this.getPriority()
		};
	}
}
