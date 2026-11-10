import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const INDEX_SCHEMA_VERSION = 1;

function getCacheFilePath(cacheDir, grfRealPath) {
	const hash = crypto.createHash('sha256').update(grfRealPath).digest('hex').slice(0, 24);
	return path.join(cacheDir, `${hash}.grfidx.json`);
}

export async function loadCachedGrfIndex(cacheDir, grfRealPath, stat) {
	if (!cacheDir) {
		return null;
	}
	const filePath = getCacheFilePath(cacheDir, grfRealPath);
	try {
		const raw = await fs.promises.readFile(filePath, 'utf8');
		const parsed = JSON.parse(raw);
		if (
			!parsed ||
			parsed.schemaVersion !== INDEX_SCHEMA_VERSION ||
			parsed.path !== grfRealPath ||
			parsed.size !== stat.size ||
			Math.abs(parsed.mtimeMs - stat.mtimeMs) > 1 ||
			!Array.isArray(parsed.entries)
		) {
			return null;
		}
		const entryMap = new Map();
		for (const rec of parsed.entries) {
			if (Array.isArray(rec) && rec.length === 7 && typeof rec[0] === 'string') {
				entryMap.set(rec[0], rec);
			}
		}
		return {
			version: parsed.version,
			fileCount: parsed.fileCount,
			entries: parsed.entries,
			entryMap,
			fromCache: true
		};
	} catch {
		return null;
	}
}

export async function saveCachedGrfIndex(cacheDir, grfRealPath, stat, indexData) {
	if (!cacheDir) {
		return;
	}
	try {
		await fs.promises.mkdir(cacheDir, { recursive: true });
		const filePath = getCacheFilePath(cacheDir, grfRealPath);
		const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
		const payload = JSON.stringify({
			schemaVersion: INDEX_SCHEMA_VERSION,
			path: grfRealPath,
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			version: indexData.version,
			fileCount: indexData.fileCount,
			entries: indexData.entries
		});
		await fs.promises.writeFile(tmpPath, payload, 'utf8');
		await fs.promises.rename(tmpPath, filePath);
	} catch (err) {
		console.warn('[AssetIndexCache] Failed to save GRF index cache:', err?.message || 'unknown');
	}
}

export async function clearAllCachedGrfIndices(cacheDir) {
	if (!cacheDir) {
		return;
	}
	try {
		await fs.promises.rm(cacheDir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors
	}
}
