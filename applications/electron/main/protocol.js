import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import {
	APP_HOST,
	APP_SCHEME,
	getMimeType,
	isAllowedMethod,
	isPathInsideRoot,
	parseByteRange,
	resolveSafeAppPath
} from './protocol-security.js';
import { buildCspHeader } from './csp.js';

export function registerPrivilegedSchemes() {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: APP_SCHEME,
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

export function resolveRendererRoot(electronDir) {
	const projectRoot = path.resolve(electronDir, '..', '..');
	const packagedRenderer = path.join(projectRoot, 'renderer');
	if (fs.existsSync(path.join(packagedRenderer, 'index.html'))) {
		return packagedRenderer;
	}
	return path.join(projectRoot, 'dist', 'DesktopRenderer');
}

export function getAppEntryUrl() {
	return `${APP_SCHEME}://${APP_HOST}/index.html`;
}

export async function registerAppProtocol({ rendererRoot, getAllowedConnectOrigins = () => [] }) {
	const rootRealPath = await fs.promises.realpath(rendererRoot);

	protocol.handle(APP_SCHEME, async request => {
		if (!isAllowedMethod(request.method)) {
			return new Response('Method Not Allowed', { status: 405 });
		}

		const resolution = resolveSafeAppPath(request.url, rootRealPath);
		if (!resolution.ok) {
			return new Response(resolution.reason === 'INVALID_URL' ? 'Bad Request' : 'Forbidden', {
				status: resolution.status
			});
		}

		let targetRealPath;
		let stat;
		try {
			targetRealPath = await fs.promises.realpath(resolution.candidate);
			if (!isPathInsideRoot(rootRealPath, targetRealPath)) {
				return new Response('Forbidden', { status: 403 });
			}
			stat = await fs.promises.stat(targetRealPath);
			if (!stat.isFile()) {
				return new Response('Forbidden', { status: 403 });
			}
		} catch (err) {
			if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
				return new Response('Not Found', { status: 404 });
			}
			return new Response('Internal Server Error', { status: 500 });
		}

		const mimeType = getMimeType(targetRealPath);
		const headers = new Headers({
			'Content-Type': mimeType,
			'Accept-Ranges': 'bytes',
			'X-Content-Type-Options': 'nosniff',
			'Cross-Origin-Resource-Policy': 'same-origin',
			'Referrer-Policy': 'no-referrer'
		});

		if (mimeType.startsWith('text/html') || mimeType.startsWith('text/javascript')) {
			headers.set(
				'Content-Security-Policy',
				buildCspHeader({
					isDev: false,
					allowedConnectOrigins: getAllowedConnectOrigins()
				})
			);
		}

		const rangeHeader = request.headers.get('range');
		const range = parseByteRange(rangeHeader, stat.size);
		if (range && !range.valid) {
			headers.set('Content-Range', `bytes */${stat.size}`);
			return new Response('Range Not Satisfiable', { status: 416, headers });
		}

		const isHead = request.method.toUpperCase() === 'HEAD';
		if (range && range.valid) {
			const chunkSize = range.end - range.start + 1;
			headers.set('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
			headers.set('Content-Length', String(chunkSize));
			if (isHead) {
				return new Response(null, { status: 206, headers });
			}
			const stream = Readable.toWeb(fs.createReadStream(targetRealPath, { start: range.start, end: range.end }));
			return new Response(stream, { status: 206, headers });
		}

		headers.set('Content-Length', String(stat.size));
		if (isHead) {
			return new Response(null, { status: 200, headers });
		}

		const stream = Readable.toWeb(fs.createReadStream(targetRealPath));
		return new Response(stream, { status: 200, headers });
	});
}
