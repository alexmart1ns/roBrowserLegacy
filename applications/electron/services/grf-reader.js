import fs from 'node:fs';
import zlib from 'node:zlib';
import GameFileDecrypt from '../../../src/Loaders/GameFileDecrypt.js';

export const GRF_HEADER_SIZE = 46;
export const GRF_VERSION_200 = 0x200;
export const GRF_VERSION_300 = 0x300;
export const GRF_SIG_MAGIC = 'Master of Magic';
export const GRF_SIG_EH3 = 'Event Horizon';

export const FILELIST_TYPE_FILE = 0x01;
export const FILELIST_TYPE_ENCRYPT_MIXED = 0x02;
export const FILELIST_TYPE_ENCRYPT_HEADER = 0x04;

const SKIP_EXTENSIONS = /\.(gnd|gat|act|str)$/i;
const MAX_TABLE_REAL_SIZE = 256 * 1024 * 1024;
const MAX_ENTRY_REAL_SIZE = 256 * 1024 * 1024;
const MAX_FILE_COUNT = 2_000_000;

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

// Windows-1252 mapping for bytes 0x80..0x9F (identical to iconv-lite windows-1252)
const CP1252_EXTRA = {
	0x80: 0x20ac,
	0x82: 0x201a,
	0x83: 0x0192,
	0x84: 0x201e,
	0x85: 0x2026,
	0x86: 0x2020,
	0x87: 0x2021,
	0x88: 0x02c6,
	0x89: 0x2030,
	0x8a: 0x0160,
	0x8b: 0x2039,
	0x8c: 0x0152,
	0x8e: 0x017d,
	0x91: 0x2018,
	0x92: 0x2019,
	0x93: 0x201c,
	0x94: 0x201d,
	0x95: 0x2022,
	0x96: 0x2013,
	0x97: 0x2014,
	0x98: 0x02dc,
	0x99: 0x2122,
	0x9a: 0x0161,
	0x9b: 0x203a,
	0x9c: 0x0153,
	0x9e: 0x017e,
	0x9f: 0x0178
};

export function decodeWindows1252(bytes) {
	let out = '';
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i];
		if (b >= 0x80 && b <= 0x9f && CP1252_EXTRA[b] !== undefined) {
			out += String.fromCharCode(CP1252_EXTRA[b]);
		} else {
			out += String.fromCharCode(b);
		}
	}
	return out;
}

export function decodeGrfFilename(bytes) {
	const utf8 = utf8Decoder.decode(bytes);
	if (!utf8.includes('\uFFFD')) {
		return utf8;
	}
	return decodeWindows1252(bytes);
}

export function normalizeAssetKey(rawPath) {
	if (typeof rawPath !== 'string') {
		return null;
	}
	const trimmed = rawPath.trim();
	if (!trimmed || trimmed.includes('\0')) {
		return null;
	}
	if (/^[a-zA-Z]:/.test(trimmed) || /^[a-zA-Z]+:\/\//.test(trimmed)) {
		return null;
	}

	const slashed = trimmed.replace(/\\/g, '/').replace(/^\/+/, '');
	if (!slashed || slashed.includes('//')) {
		return null;
	}

	const segments = slashed.split('/');
	const cleanSegments = [];
	for (const seg of segments) {
		if (!seg || seg === '.') {
			continue;
		}
		if (seg === '..') {
			return null;
		}
		cleanSegments.push(seg);
	}
	if (cleanSegments.length === 0) {
		return null;
	}
	return cleanSegments.join('/').toLowerCase();
}

export function parseDataIni(content) {
	if (typeof content !== 'string' || !content.trim()) {
		return [];
	}

	const lines = content.split(/\r?\n/);
	let inDataSection = false;
	let sawAnySection = false;
	const entries = [];

	for (const rawLine of lines) {
		const line = rawLine.replace(/[;#].*$/, '').trim();
		if (!line) {
			continue;
		}
		if (line.startsWith('[') && line.endsWith(']')) {
			sawAnySection = true;
			inDataSection = line.slice(1, -1).trim().toLowerCase() === 'data';
			continue;
		}
		if (sawAnySection && !inDataSection) {
			continue;
		}
		const match = /^(\d+)\s*=\s*(.+)$/.exec(line);
		if (match) {
			const priority = Number.parseInt(match[1], 10);
			const grfName = match[2].trim().replace(/^["']|["']$/g, '');
			if (Number.isFinite(priority) && grfName) {
				entries.push({ priority, grfName });
			}
		}
	}

	entries.sort((a, b) => a.priority - b.priority);
	return entries.map(e => e.grfName);
}

export function detectPePacketVerFromBuffer(buf) {
	if (!buf || buf.length < 0x40) {
		return null;
	}
	const peOffset = buf.readUInt32LE(0x3c);
	if (peOffset + 12 > buf.length) {
		return null;
	}
	if (buf[peOffset] !== 0x50 || buf[peOffset + 1] !== 0x45 || buf[peOffset + 2] !== 0 || buf[peOffset + 3] !== 0) {
		return null;
	}
	const timestamp = buf.readUInt32LE(peOffset + 8);
	if (!timestamp) {
		return null;
	}
	const date = new Date(timestamp * 1000);
	const packetver = date.getFullYear() * 1e4 + (date.getMonth() + 1) * 1e2 + date.getDate();
	return packetver > 20000000 ? packetver : null;
}

export async function detectPePacketVerFromFile(filePath, fileSize) {
	if (fileSize < 1024 * 1024 * 3 || fileSize > 1024 * 1024 * 7) {
		return null;
	}
	const fh = await fs.promises.open(filePath, 'r');
	try {
		const head = Buffer.alloc(Math.min(4096, fileSize));
		const { bytesRead } = await fh.read(head, 0, head.length, 0);
		return detectPePacketVerFromBuffer(head.subarray(0, bytesRead));
	} finally {
		await fh.close();
	}
}

export async function parseGrfIndexFromHandle(fh, fileSize) {
	if (fileSize < GRF_HEADER_SIZE) {
		throw new Error('GRF::load() - Not enough bytes to be a valid GRF');
	}

	const headerBuf = Buffer.alloc(GRF_HEADER_SIZE);
	const headerRead = await fh.read(headerBuf, 0, GRF_HEADER_SIZE, 0);
	if (headerRead.bytesRead < GRF_HEADER_SIZE) {
		throw new Error('GRF::load() - Truncated GRF header');
	}

	let signature = headerBuf.subarray(0, 15).toString('latin1');
	const nullPos = signature.indexOf('\0');
	if (nullPos !== -1) {
		signature = signature.slice(0, nullPos);
	}

	if (signature !== GRF_SIG_MAGIC && signature !== GRF_SIG_EH3) {
		throw new Error(`GRF::load() - Incorrect header "${signature}"`);
	}

	const version = headerBuf.readUInt32LE(42);
	if (version !== GRF_VERSION_200 && version !== GRF_VERSION_300) {
		throw new Error(`GRF::load() - Unsupported version 0x${version.toString(16)}`);
	}

	let fileTableOffset;
	let fileCount;
	if (version === GRF_VERSION_300) {
		const rawOffset = headerBuf.readBigUInt64LE(30);
		if (rawOffset > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error('GRF::load() - Table offset exceeds safe integer range');
		}
		fileTableOffset = Number(rawOffset);
		fileCount = headerBuf.readUInt32LE(38);
	} else {
		fileTableOffset = headerBuf.readUInt32LE(30);
		const skip = headerBuf.readUInt32LE(34);
		const rawCount = headerBuf.readUInt32LE(38);
		fileCount = rawCount - skip - 7;
	}

	if (!Number.isFinite(fileCount) || fileCount < 0 || fileCount > MAX_FILE_COUNT) {
		throw new Error(`GRF::load() - Invalid file count (${fileCount})`);
	}

	let tableOffset = fileTableOffset + GRF_HEADER_SIZE;
	if (version === GRF_VERSION_300) {
		tableOffset += 4;
	}

	if (fileTableOffset < 0 || tableOffset + 8 > fileSize) {
		throw new Error(`GRF::load() - Table offset out of bounds (${tableOffset} / ${fileSize})`);
	}

	const tableHeader = Buffer.alloc(8);
	await fh.read(tableHeader, 0, 8, tableOffset);
	const packSize = tableHeader.readUInt32LE(0);
	const realSize = tableHeader.readUInt32LE(4);

	if (packSize === 0 || tableOffset + 8 + packSize > fileSize) {
		throw new Error(`GRF::load() - Packed table exceeds file size (${packSize})`);
	}
	if (realSize > MAX_TABLE_REAL_SIZE) {
		throw new Error(`GRF::load() - Uncompressed table exceeds size limit (${realSize})`);
	}

	const packedTable = Buffer.allocUnsafe(packSize);
	const tableRead = await fh.read(packedTable, 0, packSize, tableOffset + 8);
	if (tableRead.bytesRead < packSize) {
		throw new Error('GRF::load() - Truncated file table');
	}

	const tableOut = zlib.inflateSync(packedTable, { maxOutputLength: MAX_TABLE_REAL_SIZE });
	if (tableOut.length !== realSize) {
		throw new Error(`GRF::load() - Table size mismatch (${tableOut.length} vs ${realSize})`);
	}

	const entries = new Array(fileCount);
	const entryMap = new Map();
	let pos = 0;

	for (let i = 0; i < fileCount; i++) {
		const start = pos;
		while (pos < tableOut.length && tableOut[pos] !== 0) {
			pos++;
		}
		if (pos >= tableOut.length) {
			throw new Error('GRF::load() - Unexpected end of GRF file table');
		}
		const displayName = decodeGrfFilename(tableOut.subarray(start, pos));
		pos++; // skip null terminator

		const metaBytes = version === GRF_VERSION_300 ? 21 : 17;
		if (pos + metaBytes > tableOut.length) {
			throw new Error('GRF::load() - Truncated GRF entry metadata');
		}

		const ePackSize = tableOut.readUInt32LE(pos);
		const eLengthAligned = tableOut.readUInt32LE(pos + 4);
		const eRealSize = tableOut.readUInt32LE(pos + 8);
		const eType = tableOut[pos + 12];
		pos += 13;

		let eOffset;
		if (version === GRF_VERSION_300) {
			const lo = tableOut.readUInt32LE(pos);
			const hi = tableOut.readUInt32LE(pos + 4);
			eOffset = lo + hi * 0x100000000;
			pos += 8;
		} else {
			eOffset = tableOut.readUInt32LE(pos);
			pos += 4;
		}

		if (eType & FILELIST_TYPE_FILE) {
			const dataStart = eOffset + GRF_HEADER_SIZE;
			if (
				eOffset < 0 ||
				dataStart + eLengthAligned > fileSize ||
				eRealSize > MAX_ENTRY_REAL_SIZE ||
				ePackSize > eLengthAligned
			) {
				// Skip corrupt/out-of-bounds entry safely instead of crashing
				continue;
			}
			const key = normalizeAssetKey(displayName);
			if (key) {
				const rec = [key, displayName, ePackSize, eLengthAligned, eRealSize, eType, eOffset];
				entries[i] = rec;
				entryMap.set(key, rec);
			}
		}
	}

	return {
		version,
		fileCount,
		entries: entries.filter(Boolean),
		entryMap
	};
}

export async function readAndDecodeGrfEntry(fh, fileSize, rec) {
	const [, displayName, packSize, lengthAligned, realSize, type, offset] = rec;

	if (!(type & FILELIST_TYPE_FILE)) {
		return null;
	}
	if (realSize === 0) {
		return new Uint8Array(0);
	}

	const start = offset + GRF_HEADER_SIZE;
	if (start < GRF_HEADER_SIZE || start + lengthAligned > fileSize) {
		throw new Error(`GRF::readEntry() - Offset out of bounds for "${displayName}"`);
	}

	const rawBuf = Buffer.allocUnsafe(lengthAligned);
	const { bytesRead } = await fh.read(rawBuf, 0, lengthAligned, start);
	if (bytesRead < lengthAligned) {
		throw new Error(`GRF::readEntry() - Truncated entry "${displayName}"`);
	}

	const data = new Uint8Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);
	const isEncrypted = type !== FILELIST_TYPE_FILE;
	let handled = false;

	if (type & FILELIST_TYPE_ENCRYPT_MIXED) {
		if (SKIP_EXTENSIONS.test(displayName)) {
			GameFileDecrypt.decodeHeader(data, lengthAligned);
		} else {
			GameFileDecrypt.decodeFull(data, lengthAligned, packSize);
		}
		handled = true;
	} else if (type & FILELIST_TYPE_ENCRYPT_HEADER) {
		GameFileDecrypt.decodeHeader(data, lengthAligned);
		handled = true;
	}

	if (isEncrypted && !handled) {
		throw new Error(`Unsupported GRF encryption flag (${type}) for "${displayName}"`);
	}

	if (
		data[0] !== 0 &&
		(data[0] !== 0x78 || (data[1] !== 0x9c && data[1] !== 0x01 && data[1] !== 0xda && data[1] !== 0x5e))
	) {
		throw new Error(`Unsupported GRF compression/encryption stream for "${displayName}"`);
	}

	const inflated = zlib.inflateSync(data.subarray(0, packSize), { maxOutputLength: MAX_ENTRY_REAL_SIZE });
	if (inflated.length === realSize) {
		const copy = new Uint8Array(realSize);
		copy.set(inflated);
		return copy;
	}

	const sized = new Uint8Array(realSize);
	sized.set(inflated.subarray(0, Math.min(inflated.length, realSize)));
	return sized;
}
