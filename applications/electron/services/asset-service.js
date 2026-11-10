import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveWorkerPath() {
	let workerPath = path.join(__dirname, 'asset-worker.mjs');
	// Support packaged ASAR apps where services are unpacked via asarUnpack
	if (workerPath.includes(`${path.sep}app.asar${path.sep}`)) {
		workerPath = workerPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
	}
	return workerPath;
}

export class AssetService {
	constructor({ cacheDir = null, managedDir = null, onProgress = null } = {}) {
		this._cacheDir = cacheDir;
		this._managedDir = managedDir;
		this._onProgress = onProgress;
		this._worker = null;
		this._nextId = 1;
		this._pending = new Map();
		this._lastDir = null;
		this._lastOptions = null;
	}

	_ensureWorker() {
		if (this._worker) {
			return this._worker;
		}
		const worker = new Worker(resolveWorkerPath(), {
			workerData: { cacheDir: this._cacheDir, managedDir: this._managedDir }
		});
		worker.on('message', msg => {
			if (msg?.type === 'progress') {
				if (this._onProgress) {
					this._onProgress(msg.progress);
				}
				return;
			}
			const pending = this._pending.get(msg?.id);
			if (!pending) {
				return;
			}
			this._pending.delete(msg.id);
			if (msg.ok) {
				pending.resolve(msg.result);
			} else {
				pending.reject(new Error(msg.error || 'Asset worker request failed'));
			}
		});
		worker.on('error', err => {
			for (const p of this._pending.values()) {
				p.reject(err);
			}
			this._pending.clear();
			this._worker = null;
		});
		worker.on('exit', () => {
			for (const p of this._pending.values()) {
				p.reject(new Error('Asset worker exited unexpectedly'));
			}
			this._pending.clear();
			this._worker = null;
		});
		this._worker = worker;
		return worker;
	}

	_call(action, payload = {}) {
		const worker = this._ensureWorker();
		const id = this._nextId++;
		return new Promise((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			worker.postMessage({ id, action, payload });
		});
	}

	async initializeDirectory(rootDir, options = {}) {
		this._lastDir = rootDir;
		this._lastOptions = options;
		return this._call('initDir', { rootDir, options });
	}

	async reindex() {
		if (!this._lastDir) {
			return this.getStatus();
		}
		return this._call('initDir', {
			rootDir: this._lastDir,
			options: { ...(this._lastOptions || {}), forceReindex: true }
		});
	}

	exists(assetPath) {
		return this._call('exists', { path: assetPath });
	}

	getFile(assetPath) {
		return this._call('getFile', { path: assetPath });
	}

	getFileInfo(assetPath) {
		return this._call('getFileInfo', { path: assetPath });
	}

	search(source, flags = '') {
		return this._call('search', { source, flags });
	}

	getStatus() {
		if (!this._worker) {
			return Promise.resolve({
				configured: false,
				rootDir: null,
				looseCount: 0,
				grfCount: 0,
				totalGrfEntries: 0,
				detectedPacketVer: null,
				priority: []
			});
		}
		return this._call('getStatus');
	}

	async clearCache() {
		if (!this._worker) {
			return { ok: true };
		}
		return this._call('invalidateCache');
	}

	async close() {
		if (!this._worker) {
			return;
		}
		try {
			await this._call('close');
		} finally {
			if (this._worker) {
				await this._worker.terminate();
				this._worker = null;
			}
		}
	}
}
