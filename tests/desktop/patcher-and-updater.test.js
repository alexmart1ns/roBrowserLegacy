import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ManifestPatcher, signManifestPayload } from '../../applications/electron/services/manifest-patcher.js';
import { AppUpdaterService, compareSemver, signAppFeedPayload } from '../../applications/electron/services/app-updater.js';
import { LocalAssetVfs } from '../../applications/electron/services/local-asset-vfs.js';
import { buildSyntheticGrfBuffer } from '../helpers/synthetic-grf.js';

const tempDirs = [];
const servers = [];

function makeTempDir(prefix = 'ro-g7-test-') {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function startTestHttpServer(routes) {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://127.0.0.1');
		const handler = routes[url.pathname];
		if (!handler) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		if (typeof handler === 'function') {
			handler(req, res);
			return;
		}
		res.writeHead(handler.status || 200, handler.headers || {});
		res.end(handler.body);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	servers.push(server);
	const { port } = server.address();
	return `http://127.0.0.1:${port}`;
}

function sha256Hex(buf) {
	return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeSignedManifest({ generation, channel = 'stable', files, privateKeyPem, baseUrl = undefined }) {
	const body = {
		manifestVersion: 1,
		generation,
		channel,
		...(baseUrl ? { baseUrl } : {}),
		files
	};
	return {
		...body,
		signature: signManifestPayload(body, privateKeyPem)
	};
}

afterEach(async () => {
	while (servers.length > 0) {
		await new Promise(resolve => servers.pop().close(resolve));
	}
	while (tempDirs.length > 0) {
		fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
	}
});

describe('ManifestPatcher & Isolated Managed Overlay (G7)', () => {
	it('verifies Ed25519 signature, applies patches atomically into managedDir without altering userDir, and overrides GRF in VFS', async () => {
		const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
		const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
		const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

		const userDir = makeTempDir('ro-user-');
		const managedDir = makeTempDir('ro-managed-');
		const cacheDir = makeTempDir('ro-cache-');

		// Create user's original client GRF (must never be modified by patcher)
		const baseGrf = buildSyntheticGrfBuffer([
			{ filename: 'data\\msgstringtable.txt', data: Buffer.from('OriginalGrf#', 'ascii') }
		]);
		const grfPath = path.join(userDir, 'data.grf');
		fs.writeFileSync(grfPath, baseGrf);
		const originalGrfSha = sha256Hex(fs.readFileSync(grfPath));

		const patchedMsg = Buffer.from('PatchedByLauncher#', 'ascii');
		const extraLua = Buffer.from('-- safe patched lua table', 'utf8');

		const routes = {
			'/data/msgstringtable.txt': { body: patchedMsg },
			'/data/luafiles514/patch.lua': { body: extraLua }
		};
		const baseUrl = await startTestHttpServer(routes);

		const manifest = makeSignedManifest({
			generation: 1,
			files: [
				{ path: 'data/msgstringtable.txt', sha256: sha256Hex(patchedMsg), size: patchedMsg.length },
				{ path: 'data/luafiles514/patch.lua', sha256: sha256Hex(extraLua), size: extraLua.length }
			],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});
		routes['/manifest.json'] = {
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(manifest)
		};

		let beforeCalled = 0;
		let afterCalled = 0;
		const patcher = new ManifestPatcher({
			managedDir,
			publicKeys: [pubPem],
			beforeApply: async () => {
				beforeCalled++;
			},
			afterApply: async () => {
				afterCalled++;
			}
		});

		const res1 = await patcher.applyFromUrl(`${baseUrl}/manifest.json`, { channel: 'stable' });
		expect(res1.ok).toBe(true);
		expect(res1.generation).toBe(1);
		expect(res1.downloadedCount).toBe(2);
		expect(beforeCalled).toBe(1);
		expect(afterCalled).toBe(1);

		// User's original GRF must remain untouched byte-for-byte
		expect(sha256Hex(fs.readFileSync(grfPath))).toBe(originalGrfSha);
		expect(fs.existsSync(path.join(userDir, 'data'))).toBe(false);

		// Repeating same generation reports upToDate without redownloading
		const res2 = await patcher.applyFromUrl(`${baseUrl}/manifest.json`, { channel: 'stable' });
		expect(res2.ok).toBe(true);
		expect(res2.upToDate).toBe(true);

		// Verify LocalAssetVfs resolves patched overlay file over user GRF
		const vfs = new LocalAssetVfs({ cacheDir, managedDir });
		await vfs.initializeDirectory(userDir);
		const resolved = await vfs.getFile('data/msgstringtable.txt');
		expect(resolved.found).toBe(true);
		expect(resolved.source).toBe('managed');
		expect(Buffer.from(resolved.bytes).toString('ascii')).toBe('PatchedByLauncher#');
		await vfs.close();
	});

	it('rejects bad manifest signature, tampered data hash, downgrade, missing file, incomplete download, and path traversal', async () => {
		const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
		const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
		const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
		const otherKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });

		const managedDir = makeTempDir('ro-sec-');
		const validBytes = Buffer.from('good-payload');
		const routes = {
			'/data/good.txt': { body: validBytes },
			'/data/corrupt.txt': { body: Buffer.from('tampered-bytes') },
			'/data/truncated.txt': (_req, res) => {
				res.writeHead(200);
				res.end('short'); // shorter than declared 50 bytes
			}
		};
		const baseUrl = await startTestHttpServer(routes);

		const patcher = new ManifestPatcher({ managedDir, publicKeys: [pubPem] });

		// 1. Bad signature
		const wrongSigManifest = makeSignedManifest({
			generation: 1,
			files: [{ path: 'data/good.txt', sha256: sha256Hex(validBytes), size: validBytes.length }],
			privateKeyPem: otherKey,
			baseUrl: `${baseUrl}/`
		});
		const badSigRes = await patcher.applyManifest(wrongSigManifest);
		expect(badSigRes.ok).toBe(false);
		expect(badSigRes.code).toBe('BAD_MANIFEST_SIGNATURE');

		// 2. Traversal path inside manifest
		const travManifest = makeSignedManifest({
			generation: 1,
			files: [{ path: '../escape.txt', sha256: sha256Hex(validBytes), size: validBytes.length }],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});
		const travRes = await patcher.applyManifest(travManifest);
		expect(travRes.ok).toBe(false);
		expect(travRes.code).toBe('UNSAFE_OR_DUPLICATE_PATH');

		// 3. Corrupt file hash mismatch
		const badHashManifest = makeSignedManifest({
			generation: 1,
			files: [{ path: 'data/corrupt.txt', sha256: sha256Hex(validBytes), size: Buffer.from('tampered-bytes').length }],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});
		const badHashRes = await patcher.applyManifest(badHashManifest);
		expect(badHashRes.ok).toBe(false);
		expect(badHashRes.code).toBe('HASH_MISMATCH');
		expect(fs.existsSync(path.join(managedDir, 'data/corrupt.txt'))).toBe(false);

		// 4. Incomplete/truncated download
		const truncManifest = makeSignedManifest({
			generation: 1,
			files: [{ path: 'data/truncated.txt', sha256: sha256Hex(Buffer.alloc(50, 65)), size: 50 }],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});
		const truncRes = await patcher.applyManifest(truncManifest);
		expect(truncRes.ok).toBe(false);
		expect(truncRes.code).toBe('INCOMPLETE_DOWNLOAD');

		// 5. Missing 404 file
		const missingManifest = makeSignedManifest({
			generation: 1,
			files: [{ path: 'data/missing.txt', sha256: sha256Hex(validBytes), size: validBytes.length }],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});
		const missingRes = await patcher.applyManifest(missingManifest);
		expect(missingRes.ok).toBe(false);
		expect(missingRes.code).toBe('MISSING_REMOTE_FILE');

		// 6. Apply generation 2 then attempt downgrade to generation 1
		const gen2Manifest = makeSignedManifest({
			generation: 2,
			files: [{ path: 'data/good.txt', sha256: sha256Hex(validBytes), size: validBytes.length }],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});
		expect((await patcher.applyManifest(gen2Manifest)).ok).toBe(true);
		const gen1Manifest = makeSignedManifest({
			generation: 1,
			files: [{ path: 'data/good.txt', sha256: sha256Hex(validBytes), size: validBytes.length }],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});
		const downgradeRes = await patcher.applyManifest(gen1Manifest);
		expect(downgradeRes.ok).toBe(false);
		expect(downgradeRes.code).toBe('DOWNGRADE_REJECTED');
	});

	it('rolls back cleanly if atomic batch swap fails partway through', async () => {
		const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
		const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
		const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
		const managedDir = makeTempDir('ro-rollback-');

		const v1A = Buffer.from('file-a-v1');
		const v2A = Buffer.from('file-a-v2-updated');
		const v2B = Buffer.from('file-b-v2-new');

		const routes = {
			'/data/a.txt': { body: v1A },
			'/v2/data/a.txt': { body: v2A },
			'/v2/data/b.txt': { body: v2B }
		};
		const baseUrl = await startTestHttpServer(routes);
		const patcher = new ManifestPatcher({ managedDir, publicKeys: [pubPem] });

		const m1 = makeSignedManifest({
			generation: 1,
			files: [{ path: 'data/a.txt', sha256: sha256Hex(v1A), size: v1A.length }],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});
		expect((await patcher.applyManifest(m1)).ok).toBe(true);

		const m2 = makeSignedManifest({
			generation: 2,
			files: [
				{
					path: 'data/a.txt',
					url: `${baseUrl}/v2/data/a.txt`,
					sha256: sha256Hex(v2A),
					size: v2A.length
				},
				{
					path: 'data/b.txt',
					url: `${baseUrl}/v2/data/b.txt`,
					sha256: sha256Hex(v2B),
					size: v2B.length
				}
			],
			privateKeyPem: privPem,
			baseUrl: `${baseUrl}/`
		});

		const failRes = await patcher.applyManifest(m2, {
			swapHookForTest: async (_item, idx) => {
				if (idx === 1) {
					throw Object.assign(new Error('Simulated disk error on second swap'), { code: 'EIO' });
				}
			}
		});

		expect(failRes.ok).toBe(false);
		expect(failRes.rolledBack).toBe(true);
		expect(fs.readFileSync(path.join(managedDir, 'data/a.txt'), 'utf8')).toBe('file-a-v1');
		expect(fs.existsSync(path.join(managedDir, 'data/b.txt'))).toBe(false);
		expect(patcher.readState().generation).toBe(1);
	});

	it('handles non-writable managedDir collision cleanly without corrupting state', async () => {
		const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
		const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
		const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
		const dir = makeTempDir('ro-readonly-');
		const fileBlockingDir = path.join(dir, 'not-a-dir');
		fs.writeFileSync(fileBlockingDir, 'locked-file');

		const patcher = new ManifestPatcher({ managedDir: fileBlockingDir, publicKeys: [pubPem] });
		const bytes = Buffer.from('x');
		const m = makeSignedManifest({
			generation: 1,
			files: [{ path: 'data/x.txt', sha256: sha256Hex(bytes), size: 1, url: 'https://example.org/x.txt' }],
			privateKeyPem: privPem
		});
		const res = await patcher.applyManifest(m);
		expect(res.ok).toBe(false);
		expect(res.code).toBe('DIRECTORY_NOT_WRITABLE');
	});
});

describe('AppUpdaterService (G7)', () => {
	it('compares semver properly across stable and beta prereleases', () => {
		expect(compareSemver('2.1.0', '2.0.0')).toBe(1);
		expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
		expect(compareSemver('2.1.0-beta.1', '2.1.0')).toBe(-1);
		expect(compareSemver('1.9.9', '2.0.0')).toBe(-1);
	});

	it('verifies signed app update feed, validates SHA-256, and defers installation during active gameplay', async () => {
		const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
		const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
		const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
		const updatesDir = makeTempDir('ro-app-upd-');

		const fakeInstaller = Buffer.from('MZ_FAKE_SIGNED_INSTALLER_PAYLOAD_BYTES');
		const feedBody = {
			feedVersion: 1,
			channel: 'stable',
			version: '2.1.0',
			artifactName: 'roBrowserLegacy-Setup-2.1.0.exe',
			artifactUrl: 'roBrowserLegacy-Setup-2.1.0.exe',
			sha256: sha256Hex(fakeInstaller),
			size: fakeInstaller.length,
			releaseNotes: 'Fixes and improvements'
		};
		const signedFeed = {
			...feedBody,
			signature: signAppFeedPayload(feedBody, privPem)
		};

		const baseUrl = await startTestHttpServer({
			'/updates/stable.json': {
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(signedFeed)
			},
			'/updates/roBrowserLegacy-Setup-2.1.0.exe': { body: fakeInstaller }
		});

		const updater = new AppUpdaterService({
			currentVersion: '2.0.0',
			updatesDir,
			publicKeys: [pubPem]
		});

		// Check wrong channel fails
		const betaRes = await updater.checkForUpdates({ feedUrl: `${baseUrl}/updates/`, channel: 'beta' });
		expect(betaRes.ok).toBe(false);

		// Check stable channel succeeds
		const checkRes = await updater.checkForUpdates({ feedUrl: `${baseUrl}/updates/`, channel: 'stable' });
		expect(checkRes.ok).toBe(true);
		expect(checkRes.updateAvailable).toBe(true);
		expect(checkRes.update.version).toBe('2.1.0');

		// Simulate active gameplay -> download allowed in background, install deferred
		updater.setGameplayActive(true);
		const dlRes = await updater.downloadAvailableUpdate();
		expect(dlRes.ok).toBe(true);
		expect(dlRes.deferredForGameplay).toBe(true);

		const deferredInstall = await updater.prepareInstall();
		expect(deferredInstall.ok).toBe(false);
		expect(deferredInstall.code).toBe('DEFERRED_UNTIL_RESTART');

		// Exit gameplay -> install permitted
		updater.setGameplayActive(false);
		const readyInstall = await updater.prepareInstall();
		expect(readyInstall.ok).toBe(true);
		expect(fs.existsSync(readyInstall.installerPath)).toBe(true);
	});
});
