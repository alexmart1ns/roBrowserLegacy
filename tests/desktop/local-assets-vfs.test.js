import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSyntheticGrfBuffer } from '../helpers/synthetic-grf.js';
import {
	decodeGrfFilename,
	detectPePacketVerFromBuffer,
	normalizeAssetKey,
	parseDataIni
} from '../../applications/electron/services/grf-reader.js';
import { LocalAssetVfs } from '../../applications/electron/services/local-asset-vfs.js';
import { AssetService } from '../../applications/electron/services/asset-service.js';
import TextEncoding from 'Utils/CodepageManager.js';

class MockFileReaderSync {
	readAsArrayBuffer(blob) {
		if (blob instanceof Uint8Array) {
			const copy = new Uint8Array(blob.length);
			copy.set(blob);
			return copy.buffer;
		}
		if (blob && blob._rawBytes) {
			const copy = new Uint8Array(blob._rawBytes.length);
			copy.set(blob._rawBytes);
			return copy.buffer;
		}
		throw new Error('MockFileReaderSync: unsupported blob');
	}
}
globalThis.FileReaderSync = MockFileReaderSync;
import GRF from 'Loaders/GameFile.js';

function createBrowserMockFile(buf) {
	return {
		size: buf.byteLength,
		slice(start, end) {
			const sliceBytes = buf.subarray(start, end);
			const blob = new Blob([sliceBytes]);
			blob._rawBytes = sliceBytes;
			return blob;
		}
	};
}

const tempDirs = [];
const openServices = [];

function makeTempDir(prefix = 'ro-vfs-test-') {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function createFakeRoExeBuffer(unixTimestampSec, totalSize = 4 * 1024 * 1024) {
	const buf = Buffer.alloc(totalSize);
	const peOffset = 0x80;
	buf.writeUInt32LE(peOffset, 0x3c);
	buf.write('PE\0\0', peOffset, 'ascii');
	buf.writeUInt32LE(unixTimestampSec, peOffset + 8);
	return buf;
}

afterEach(async () => {
	while (openServices.length) {
		const svc = openServices.pop();
		await svc.close();
	}
	while (tempDirs.length) {
		const d = tempDirs.pop();
		fs.rmSync(d, { recursive: true, force: true });
	}
});

describe('LocalAssetVfs & GRF byte parity', () => {
	it('enforces DATA.INI numeric precedence and loose file overrides over GRF size order', async () => {
		const roDir = makeTempDir();
		const cacheDir = makeTempDir('ro-vfs-cache-');

		// Make patch.grf (priority 0) larger than base.grf (priority 1) to prove DATA.INI order beats file size
		const patchBytes = buildSyntheticGrfBuffer([
			{ filename: 'data\\msgstringtable.txt', data: Buffer.from('FROM_PATCH_GRF', 'ascii') },
			{ filename: 'data\\padding.bin', data: Buffer.alloc(8192, 0xaa) }
		]);
		const baseBytes = buildSyntheticGrfBuffer([
			{ filename: 'data\\msgstringtable.txt', data: Buffer.from('FROM_BASE_GRF', 'ascii') },
			{ filename: 'data\\onlybase.txt', data: Buffer.from('ONLY_BASE', 'ascii') }
		]);

		fs.writeFileSync(path.join(roDir, 'patch.grf'), patchBytes);
		fs.writeFileSync(path.join(roDir, 'base.grf'), baseBytes);
		fs.writeFileSync(
			path.join(roDir, 'DATA.INI'),
			'[Data]\r\n0=patch.grf\r\n1=base.grf\r\n; comment\r\n2=missing_optional.grf\r\n',
			'ascii'
		);

		// Loose file overrides all GRFs
		fs.mkdirSync(path.join(roDir, 'data', 'sprite'), { recursive: true });
		fs.writeFileSync(path.join(roDir, 'data', 'onlybase.txt'), 'FROM_LOOSE_FILE', 'ascii');
		fs.writeFileSync(path.join(roDir, 'data', 'sprite', 'hero.SPR'), Buffer.from([1, 2, 3, 4]));

		const vfs = new LocalAssetVfs({ cacheDir });
		openServices.push(vfs);
		const status = await vfs.initializeDirectory(roDir);

		expect(status.configured).toBe(true);
		expect(status.grfCount).toBe(2);
		expect(status.looseCount).toBe(2);
		expect(status.priority.map(p => p.name)).toContain('patch.grf');

		const msgRes = await vfs.getFile('data/MSGSTRINGTABLE.txt');
		expect(msgRes.found).toBe(true);
		expect(Buffer.from(msgRes.bytes).toString('ascii')).toBe('FROM_PATCH_GRF');

		const looseRes = await vfs.getFile('data\\onlybase.txt');
		expect(looseRes.found).toBe(true);
		expect(looseRes.source).toBe('loose');
		expect(Buffer.from(looseRes.bytes).toString('ascii')).toBe('FROM_LOOSE_FILE');

		// Case-insensitive extension lookup
		const sprRes = await vfs.getFile('data/sprite/hero.spr');
		expect(sprRes.found).toBe(true);
		expect(Array.from(sprRes.bytes)).toEqual([1, 2, 3, 4]);
	});

	it('produces identical bytes to browser GameFile loader across 0x200, 0x300, empty files, and CP1252 paths', async () => {
		const roDir = makeTempDir();
		const cp1252WaterBytes = Buffer.concat([
			Buffer.from('data\\texture\\', 'ascii'),
			Buffer.from([0xbf, 0xf6, 0xc5, 0xcd]), // EUC-KR 워터 -> CP1252 ¿öÅÍ
			Buffer.from('\\water000.jpg', 'ascii')
		]);
		const waterPayload = crypto.randomBytes(2048);
		const spritePayload = Buffer.from([0x53, 0x50, 0x02, 0x01, 0x00, 0xff, 0x7f]);
		const emptyPayload = Buffer.alloc(0);

		// Verify filename decode matches CodepageManager identically
		expect(decodeGrfFilename(cp1252WaterBytes)).toBe(TextEncoding.decode(new Uint8Array(cp1252WaterBytes), 'utf-8'));

		const grf200 = buildSyntheticGrfBuffer(
			[
				{ filenameBytes: cp1252WaterBytes, data: waterPayload },
				{ filename: 'data\\empty.txt', data: emptyPayload }
			],
			{ version: 0x200 }
		);
		const grf300 = buildSyntheticGrfBuffer([{ filename: 'data\\test300.spr', data: spritePayload }], {
			version: 0x300
		});

		fs.writeFileSync(path.join(roDir, 'v200.grf'), grf200);
		fs.writeFileSync(path.join(roDir, 'v300.grf'), grf300);

		const vfs = new LocalAssetVfs();
		openServices.push(vfs);
		await vfs.initializeDirectory(roDir, { grfList: ['v200.grf', 'v300.grf'] });

		// Browser GameFile mock file
		const mock200 = new GRF(createBrowserMockFile(grf200));
		const mock300 = new GRF(createBrowserMockFile(grf300));

		const browserWater = await new Promise(resolve => {
			mock200.getFile('data\\texture\\\xbf\xf6\xc5\xcd\\water000.jpg', buf => resolve(new Uint8Array(buf)));
		});
		const desktopWater = await vfs.getFile('data/texture/\xbf\xf6\xc5\xcd/water000.jpg');
		expect(desktopWater.found).toBe(true);
		expect(Buffer.compare(Buffer.from(desktopWater.bytes), Buffer.from(browserWater))).toBe(0);

		const browser300 = await new Promise(resolve => {
			mock300.getFile('data\\test300.spr', buf => resolve(new Uint8Array(buf)));
		});
		const desktop300 = await vfs.getFile('data\\test300.spr');
		expect(desktop300.found).toBe(true);
		expect(Buffer.compare(Buffer.from(desktop300.bytes), Buffer.from(browser300))).toBe(0);

		const emptyRes = await vfs.getFile('data/empty.txt');
		expect(emptyRes.found).toBe(true);
		expect(emptyRes.bytes.byteLength).toBe(0);
	});

	it('persists and invalidates GRF index cache and closes handles cleanly', async () => {
		const roDir = makeTempDir();
		const cacheDir = makeTempDir('ro-cache-');
		const grfPath = path.join(roDir, 'data.grf');

		fs.writeFileSync(grfPath, buildSyntheticGrfBuffer([{ filename: 'data\\a.txt', data: Buffer.from('A1') }]));

		const vfs = new LocalAssetVfs({ cacheDir });
		openServices.push(vfs);

		const first = await vfs.initializeDirectory(roDir);
		expect(first.indexCacheMisses).toBe(1);
		expect(first.indexCacheHits).toBe(0);

		const second = await vfs.initializeDirectory(roDir);
		expect(second.indexCacheHits).toBe(1);
		expect(second.indexCacheMisses).toBe(0);

		// Modify GRF on disk -> cache must invalidate automatically
		fs.writeFileSync(grfPath, buildSyntheticGrfBuffer([{ filename: 'data\\a.txt', data: Buffer.from('A2_UPDATED') }]));
		const third = await vfs.initializeDirectory(roDir);
		expect(third.indexCacheMisses).toBe(1);
		const updated = await vfs.getFile('data/a.txt');
		expect(Buffer.from(updated.bytes).toString('ascii')).toBe('A2_UPDATED');
	});

	it('rejects path traversal, invalid paths, and corrupt/truncated GRFs without crashing', async () => {
		expect(normalizeAssetKey('../secret.txt')).toBeNull();
		expect(normalizeAssetKey('data\\..\\..\\secret.txt')).toBeNull();
		expect(normalizeAssetKey('C:\\Windows\\win.ini')).toBeNull();
		expect(normalizeAssetKey('file:///etc/passwd')).toBeNull();
		expect(normalizeAssetKey('data/file\0.txt')).toBeNull();

		const roDir = makeTempDir();
		fs.writeFileSync(path.join(roDir, 'corrupt.grf'), Buffer.from('NOT_A_GRF_AT_ALL_1234567890'));
		fs.writeFileSync(
			path.join(roDir, 'DATA.INI'),
			'[Data]\n0=..\\outside.grf\n1=corrupt.grf\n'
		);

		const vfs = new LocalAssetVfs();
		openServices.push(vfs);
		const status = await vfs.initializeDirectory(roDir);
		expect(status.grfCount).toBe(0);
		expect(status.missingGrfs.length).toBe(2);
		expect((await vfs.getFile('../secret.txt')).found).toBe(false);
	});

	it('runs AssetService in worker thread, detects PE PACKETVER, searches, and releases handles', async () => {
		const roDir = makeTempDir();
		const cacheDir = makeTempDir('ro-worker-cache-');

		// 2021-06-18 UTC timestamp
		const ts = Math.floor(Date.UTC(2021, 5, 18, 12, 0, 0) / 1000);
		fs.writeFileSync(path.join(roDir, 'Ragexe.exe'), createFakeRoExeBuffer(ts));
		expect(detectPePacketVerFromBuffer(fs.readFileSync(path.join(roDir, 'Ragexe.exe')).subarray(0, 512))).toBe(
			20210618
		);

		fs.writeFileSync(
			path.join(roDir, 'data.grf'),
			buildSyntheticGrfBuffer([
				{ filename: 'data\\luafiles514\\lua files\\msgstringtable.lub', data: Buffer.from('LUA_DATA') },
				{ filename: 'data\\prontera.rsw', data: Buffer.from('RSW_DATA') }
			])
		);
		fs.mkdirSync(path.join(roDir, 'BGM'), { recursive: true });
		fs.writeFileSync(path.join(roDir, 'BGM', '01.mp3'), Buffer.from('ID3_FAKE_MP3'));

		const svc = new AssetService({ cacheDir });
		openServices.push(svc);
		const status = await svc.initializeDirectory(roDir);

		expect(status.configured).toBe(true);
		expect(status.detectedPacketVer).toBe(20210618);
		expect(status.grfCount).toBe(1);
		expect(status.looseCount).toBe(1);

		const matches = await svc.search('\\.lub$', 'i');
		expect(matches).toEqual(['data\\luafiles514\\lua files\\msgstringtable.lub']);

		const rsw = await svc.getFile('data/prontera.rsw');
		expect(rsw.found).toBe(true);
		expect(Buffer.from(rsw.bytes).toString('ascii')).toBe('RSW_DATA');

		await svc.close();
	});

	it('parses DATA.INI ignoring comments and preserving numeric order', () => {
		const parsed = parseDataIni(`
			; header comment
			[Data]
			2=data.grf
			0="custom patch.grf"
			1=rdata.grf
			[Other]
			9=ignored.grf
		`);
		expect(parsed).toEqual(['custom patch.grf', 'rdata.grf', 'data.grf']);
	});
});
