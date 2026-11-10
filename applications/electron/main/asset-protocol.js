import fs from 'node:fs';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { getMimeType, parseByteRange } from './protocol-security.js';
import { normalizeAssetKey } from '../services/grf-reader.js';

export const ASSET_SCHEME = 'ro-asset';
export const ASSET_HOST = 'local';

export function registerAssetScheme() {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: ASSET_SCHEME,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
				stream: true
			}
		}
	]);
}

function getCorsOrigin({ isDev = false, devOrigin = 'http://localhost:3000' } = {}) {
	return isDev ? devOrigin : 'app://robrowser';
}

export function registerAssetProtocol({ assetService, isDev = false, devOrigin = 'http://localhost:3000' }) {
	const corsOrigin = getCorsOrigin({ isDev, devOrigin });

	protocol.handle(ASSET_SCHEME, async request => {
		let parsed;
		try {
			parsed = new URL(request.url);
		} catch {
			return new Response('Bad Request', { status: 400 });
		}

		if (parsed.protocol !== `${ASSET_SCHEME}:` || parsed.hostname !== ASSET_HOST) {
			return new Response('Forbidden', { status: 403 });
		}

		const method = String(request.method || 'GET').toUpperCase();
		const baseHeaders = {
			'Access-Control-Allow-Origin': corsOrigin,
			'X-Content-Type-Options': 'nosniff',
			'Cross-Origin-Resource-Policy': 'cross-origin'
		};

		if (method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: {
					...baseHeaders,
					'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Range'
				}
			});
		}

		if (parsed.pathname === '/status' && method === 'GET') {
			const status = await assetService.getStatus();
			return new Response(JSON.stringify(status), {
				status: 200,
				headers: {
					...baseHeaders,
					'Content-Type': 'application/json; charset=utf-8'
				}
			});
		}

		if (parsed.pathname === '/search' && method === 'POST') {
			try {
				const body = await request.json();
				const matches = await assetService.search(body?.source || '', body?.flags || '');
				return new Response(JSON.stringify(matches), {
					status: 200,
					headers: {
						...baseHeaders,
						'Content-Type': 'application/json; charset=utf-8'
					}
				});
			} catch {
				return new Response('Bad Request', { status: 400, headers: baseHeaders });
			}
		}

		if ((method !== 'GET' && method !== 'HEAD') || !parsed.pathname.startsWith('/asset/')) {
			return new Response('Not Found', { status: 404, headers: baseHeaders });
		}

		let rawAssetPath;
		try {
			rawAssetPath = decodeURIComponent(parsed.pathname.slice('/asset/'.length));
		} catch {
			return new Response('Bad Request', { status: 400, headers: baseHeaders });
		}

		const safeKey = normalizeAssetKey(rawAssetPath);
		if (!safeKey) {
			return new Response('Forbidden', { status: 403, headers: baseHeaders });
		}

		const rangeHeader = request.headers.get('range');
		const info = await assetService.getFileInfo(safeKey);
		if (!info || !info.found) {
			return new Response('Not Found', { status: 404, headers: baseHeaders });
		}

		const mimeType = getMimeType(safeKey);
		const headers = new Headers({
			...baseHeaders,
			'Content-Type': mimeType,
			'Accept-Ranges': 'bytes'
		});

		const range = parseByteRange(rangeHeader, info.size);
		if (range && !range.valid) {
			headers.set('Content-Range', `bytes */${info.size}`);
			return new Response('Range Not Satisfiable', { status: 416, headers });
		}

		// Stream loose files directly from disk without buffering entire file in RAM
		if (info.source === 'loose' && info.realPath) {
			if (method === 'HEAD') {
				headers.set('Content-Length', String(range ? range.end - range.start + 1 : info.size));
				if (range) {
					headers.set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
					return new Response(null, { status: 206, headers });
				}
				return new Response(null, { status: 200, headers });
			}

			if (range) {
				const chunkSize = range.end - range.start + 1;
				headers.set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
				headers.set('Content-Length', String(chunkSize));
				const stream = Readable.toWeb(
					fs.createReadStream(info.realPath, { start: range.start, end: range.end })
				);
				return new Response(stream, { status: 206, headers });
			}

			headers.set('Content-Length', String(info.size));
			const stream = Readable.toWeb(fs.createReadStream(info.realPath));
			return new Response(stream, { status: 200, headers });
		}

		// GRF entry: read & decode exact requested entry slice in worker
		if (method === 'HEAD') {
			headers.set('Content-Length', String(range ? range.end - range.start + 1 : info.size));
			if (range) {
				headers.set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
				return new Response(null, { status: 206, headers });
			}
			return new Response(null, { status: 200, headers });
		}

		const res = await assetService.getFile(safeKey);
		if (!res || !res.found || !res.bytes) {
			return new Response('Not Found', { status: 404, headers: baseHeaders });
		}

		if (range) {
			const slice = res.bytes.subarray(range.start, range.end + 1);
			headers.set('Content-Range', `bytes ${range.start}-${range.end}/${res.bytes.byteLength}`);
			headers.set('Content-Length', String(slice.byteLength));
			return new Response(slice, { status: 206, headers });
		}

		headers.set('Content-Length', String(res.bytes.byteLength));
		return new Response(res.bytes, { status: 200, headers });
	});
}
