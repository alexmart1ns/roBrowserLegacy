import path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'robrowser';

export const MIME_TYPES = Object.freeze({
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.bmp': 'image/bmp',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wasm': 'application/wasm',
	'.otf': 'font/otf',
	'.ttf': 'font/ttf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
});

export function getMimeType(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	return MIME_TYPES[ext] || 'application/octet-stream';
}

export function isAllowedMethod(method) {
	const upper = String(method || 'GET').toUpperCase();
	return upper === 'GET' || upper === 'HEAD';
}

function hasForbiddenControlChars(value) {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}
	return false;
}

export function resolveSafeAppPath(requestUrl, rootDir) {
	if (typeof requestUrl !== 'string' || hasForbiddenControlChars(requestUrl)) {
		return { ok: false, status: 400, reason: 'INVALID_URL' };
	}

	let parsed;
	try {
		parsed = new URL(requestUrl);
	} catch {
		return { ok: false, status: 400, reason: 'INVALID_URL' };
	}

	if (parsed.protocol !== `${APP_SCHEME}:`) {
		return { ok: false, status: 403, reason: 'INVALID_SCHEME' };
	}

	if (parsed.hostname !== APP_HOST || parsed.username || parsed.password || parsed.port) {
		return { ok: false, status: 403, reason: 'FORBIDDEN_HOST' };
	}

	const rawAuthorityPath = requestUrl.slice(`${APP_SCHEME}://${APP_HOST}`.length).split(/[?#]/)[0];
	if (rawAuthorityPath.includes('\\') || rawAuthorityPath.includes('//')) {
		return { ok: false, status: 403, reason: 'PATH_TRAVERSAL' };
	}

	let rawDecodedForSegmentCheck;
	try {
		rawDecodedForSegmentCheck = decodeURIComponent(rawAuthorityPath);
	} catch {
		return { ok: false, status: 400, reason: 'MALFORMED_PERCENT_ENCODING' };
	}

	if (
		rawDecodedForSegmentCheck.includes('\\') ||
		rawDecodedForSegmentCheck.includes('//') ||
		rawDecodedForSegmentCheck.split('/').some(seg => seg === '.' || seg === '..')
	) {
		return { ok: false, status: 403, reason: 'PATH_TRAVERSAL' };
	}

	let decodedPath;
	try {
		decodedPath = decodeURIComponent(parsed.pathname);
	} catch {
		return { ok: false, status: 400, reason: 'MALFORMED_PERCENT_ENCODING' };
	}

	if (hasForbiddenControlChars(decodedPath) || decodedPath.includes('\\') || decodedPath.includes('//')) {
		return { ok: false, status: 403, reason: 'FORBIDDEN_CHARACTERS' };
	}

	if (/^\/?[a-zA-Z]:/.test(decodedPath)) {
		return { ok: false, status: 403, reason: 'FORBIDDEN_DRIVE_PATH' };
	}

	const rawSegments = decodedPath.split('/').filter(Boolean);
	for (const seg of rawSegments) {
		if (seg === '.' || seg === '..') {
			return { ok: false, status: 403, reason: 'PATH_TRAVERSAL' };
		}
	}

	const relativePath = rawSegments.length === 0 ? 'index.html' : rawSegments.join(path.sep);
	const resolvedRoot = path.resolve(rootDir);
	const candidate = path.resolve(resolvedRoot, relativePath);
	const rel = path.relative(resolvedRoot, candidate);

	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
		return { ok: false, status: 403, reason: 'OUTSIDE_ROOT' };
	}

	return {
		ok: true,
		resolvedRoot,
		candidate,
		relativePath: rawSegments.length === 0 ? 'index.html' : rawSegments.join('/')
	};
}

export function isPathInsideRoot(rootRealPath, targetRealPath) {
	const rel = path.relative(rootRealPath, targetRealPath);
	return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function parseByteRange(rangeHeader, totalSize) {
	if (!rangeHeader) {
		return null;
	}

	const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
	if (!match) {
		return { valid: false };
	}

	const [, startStr, endStr] = match;
	if (!startStr && !endStr) {
		return { valid: false };
	}

	let start;
	let end;

	if (!startStr) {
		const suffixLen = Number.parseInt(endStr, 10);
		if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
			return { valid: false };
		}
		start = Math.max(0, totalSize - suffixLen);
		end = totalSize - 1;
	} else {
		start = Number.parseInt(startStr, 10);
		end = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;
	}

	if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalSize) {
		return { valid: false };
	}

	end = Math.min(end, totalSize - 1);
	return { valid: true, start, end };
}
