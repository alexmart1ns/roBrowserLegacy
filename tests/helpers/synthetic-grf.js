import zlib from 'node:zlib';

const HEADER_SIZE = 46;
const FILELIST_TYPE_FILE = 0x01;
const FILELIST_TYPE_ENCRYPT_MIXED = 0x02;
const FILELIST_TYPE_ENCRYPT_HEADER = 0x04;

// Minimal valid synthetic GRF builder (0x200 and 0x300) for testing and benchmarking.
// Produces zlib-compressed entries without shipping any proprietary Gravity assets.
export function buildSyntheticGrfBuffer(entries, { version = 0x200, magic = 'Master of Magic' } = {}) {
	const dataChunks = [];
	const tableRecords = [];
	let currentOffset = 0; // relative to byte 46 (after header)

	for (const entry of entries) {
		const rawBytes = entry.data instanceof Uint8Array ? entry.data : Buffer.from(entry.data);
		const isDir = Boolean(entry.isDirectory);
		if (isDir) {
			tableRecords.push({
				filenameBytes: entry.filenameBytes || Buffer.from(entry.filename, 'latin1'),
				packSize: 0,
				lengthAligned: 0,
				realSize: 0,
				type: 0,
				offset: 0
			});
			continue;
		}

		const compressed = zlib.deflateSync(rawBytes);
		// Pad to 8-byte boundary if encrypted flag is set (though synthetic entries default to unencrypted FILE)
		const padLen = (8 - (compressed.length % 8)) % 8;
		const aligned = padLen > 0 ? Buffer.concat([compressed, Buffer.alloc(padLen)]) : compressed;

		dataChunks.push(aligned);
		tableRecords.push({
			filenameBytes: entry.filenameBytes || Buffer.from(entry.filename, 'latin1'),
			packSize: compressed.length,
			lengthAligned: aligned.length,
			realSize: rawBytes.length,
			type: entry.type ?? FILELIST_TYPE_FILE,
			offset: currentOffset
		});
		currentOffset += aligned.length;
	}

	const tableRawChunks = [];
	for (const rec of tableRecords) {
		const entryMetaSize = version === 0x300 ? 21 : 17;
		const row = Buffer.alloc(rec.filenameBytes.length + 1 + entryMetaSize);
		rec.filenameBytes.copy(row, 0);
		let p = rec.filenameBytes.length;
		row[p++] = 0;
		row.writeUInt32LE(rec.packSize, p);
		p += 4;
		row.writeUInt32LE(rec.lengthAligned, p);
		p += 4;
		row.writeUInt32LE(rec.realSize, p);
		p += 4;
		row[p++] = rec.type;
		if (version === 0x300) {
			const bigOffset = BigInt(rec.offset);
			row.writeUInt32LE(Number(bigOffset & 0xffffffffn), p);
			p += 4;
			row.writeUInt32LE(Number((bigOffset >> 32n) & 0xffffffffn), p);
		} else {
			row.writeUInt32LE(rec.offset >>> 0, p);
		}
		tableRawChunks.push(row);
	}

	const tableUncompressed = Buffer.concat(tableRawChunks);
	const tableCompressed = zlib.deflateSync(tableUncompressed);

	const header = Buffer.alloc(HEADER_SIZE);
	Buffer.from(magic, 'ascii').copy(header, 0, 0, Math.min(15, magic.length));
	const fileTableOffset = currentOffset;

	if (version === 0x300) {
		header.writeBigUInt64LE(BigInt(fileTableOffset), 30);
		header.writeUInt32LE(tableRecords.length, 38);
		header.writeUInt32LE(0x300, 42);

		const unknown4 = Buffer.alloc(4);
		const tableHeader = Buffer.alloc(8);
		tableHeader.writeUInt32LE(tableCompressed.length, 0);
		tableHeader.writeUInt32LE(tableUncompressed.length, 4);
		return Buffer.concat([header, ...dataChunks, unknown4, tableHeader, tableCompressed]);
	}

	header.writeUInt32LE(fileTableOffset >>> 0, 30);
	header.writeUInt32LE(0, 34); // skip
	header.writeUInt32LE(tableRecords.length + 7, 38);
	header.writeUInt32LE(0x200, 42);

	const tableHeader = Buffer.alloc(8);
	tableHeader.writeUInt32LE(tableCompressed.length, 0);
	tableHeader.writeUInt32LE(tableUncompressed.length, 4);
	return Buffer.concat([header, ...dataChunks, tableHeader, tableCompressed]);
}

export const GRF_FLAGS = {
	FILELIST_TYPE_FILE,
	FILELIST_TYPE_ENCRYPT_MIXED,
	FILELIST_TYPE_ENCRYPT_HEADER
};
