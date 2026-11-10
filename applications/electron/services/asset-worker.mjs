import { parentPort, workerData } from 'node:worker_threads';
import { LocalAssetVfs } from './local-asset-vfs.js';

const vfs = new LocalAssetVfs({
	cacheDir: workerData?.cacheDir || null,
	onProgress: progress => {
		parentPort.postMessage({ type: 'progress', progress });
	}
});

// Serialize mutating lifecycle ops (init/close/invalidate) while keeping reads concurrent
let lifecycleQueue = Promise.resolve();
function runSerialized(fn) {
	const next = lifecycleQueue.then(fn, fn);
	lifecycleQueue = next.catch(() => {});
	return next;
}

parentPort.on('message', async msg => {
	const { id, action, payload } = msg;
	try {
		let result;
		let transferList;

		switch (action) {
			case 'initDir':
				result = await runSerialized(() => vfs.initializeDirectory(payload.rootDir, payload.options));
				break;

			case 'exists':
				result = vfs.exists(payload.path);
				break;

			case 'getFile': {
				const fileRes = await vfs.getFile(payload.path);
				if (fileRes.found && fileRes.bytes instanceof Uint8Array) {
					result = fileRes;
					transferList = [fileRes.bytes.buffer];
				} else {
					result = fileRes;
				}
				break;
			}

			case 'getFileInfo':
				result = await vfs.getFileInfo(payload.path);
				break;

			case 'search':
				result = vfs.search(payload.source, payload.flags);
				break;

			case 'getStatus':
				result = vfs.getStatus();
				break;

			case 'invalidateCache':
				await runSerialized(() => vfs.invalidateCache());
				result = { ok: true };
				break;

			case 'close':
				await runSerialized(() => vfs.close());
				result = { ok: true };
				break;

			default:
				throw new Error(`Unknown asset worker action: ${action}`);
		}

		parentPort.postMessage({ id, ok: true, result }, transferList);
	} catch (err) {
		parentPort.postMessage({ id, ok: false, error: err?.message || 'Asset worker error' });
	}
});
