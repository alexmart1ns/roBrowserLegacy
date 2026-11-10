import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
	APP_HOST,
	APP_SCHEME,
	getMimeType,
	isAllowedMethod,
	isPathInsideRoot,
	parseByteRange,
	resolveSafeAppPath
} from '../../applications/electron/main/protocol-security.js';
import { buildCspHeader } from '../../applications/electron/main/csp.js';

describe('Electron app:// protocol security', () => {
	const rootDir = path.resolve('/tmp/robrowser-renderer');

	it('resolves root path and valid nested paths inside renderer root', () => {
		const rootRes = resolveSafeAppPath(`${APP_SCHEME}://${APP_HOST}/`, rootDir);
		expect(rootRes.ok).toBe(true);
		expect(rootRes.relativePath).toBe('index.html');
		expect(rootRes.candidate).toBe(path.resolve(rootDir, 'index.html'));

		const assetRes = resolveSafeAppPath(`${APP_SCHEME}://${APP_HOST}/assets/main-123.js`, rootDir);
		expect(assetRes.ok).toBe(true);
		expect(assetRes.relativePath).toBe('assets/main-123.js');
	});

	it('handles spaces and Unicode filenames safely inside root', () => {
		const res = resolveSafeAppPath(`${APP_SCHEME}://${APP_HOST}/assets/mapa%20%E6%97%A5%E6%9C%AC%E8%AA%9E.png`, rootDir);
		expect(res.ok).toBe(true);
		expect(res.relativePath).toBe('assets/mapa 日本語.png');
	});

	it('blocks path traversal, encoded traversal, backslashes, UNC, null bytes, and drive letters', () => {
		const attacks = [
			`${APP_SCHEME}://${APP_HOST}/../package.json`,
			`${APP_SCHEME}://${APP_HOST}/assets/../../secret.txt`,
			`${APP_SCHEME}://${APP_HOST}/%2e%2e/secret.txt`,
			`${APP_SCHEME}://${APP_HOST}/assets/%2e%2e/%2e%2e/secret.txt`,
			`${APP_SCHEME}://${APP_HOST}/assets\\..\\secret.txt`,
			`${APP_SCHEME}://${APP_HOST}/%5c..%5csecret.txt`,
			`${APP_SCHEME}://${APP_HOST}//server/share/file.js`,
			`${APP_SCHEME}://${APP_HOST}/C:/Windows/System32/cmd.exe`,
			`${APP_SCHEME}://${APP_HOST}/assets/file%00.js`,
			`${APP_SCHEME}://${APP_HOST}/%ZZ`
		];

		for (const url of attacks) {
			const res = resolveSafeAppPath(url, rootDir);
			expect(res.ok).toBe(false);
			expect([400, 403]).toContain(res.status);
		}
	});

	it('blocks unexpected schemes, hosts, ports, and credentials', () => {
		expect(resolveSafeAppPath('https://robrowser/index.html', rootDir).ok).toBe(false);
		expect(resolveSafeAppPath('app://localhost/index.html', rootDir).ok).toBe(false);
		expect(resolveSafeAppPath('app://evil.com/index.html', rootDir).ok).toBe(false);
		expect(resolveSafeAppPath('app://user:pass@robrowser/index.html', rootDir).ok).toBe(false);
		expect(resolveSafeAppPath('app://robrowser:8080/index.html', rootDir).ok).toBe(false);
	});

	it('detects symlink escapes via isPathInsideRoot', () => {
		expect(isPathInsideRoot('/app/renderer', '/app/renderer/assets/a.js')).toBe(true);
		expect(isPathInsideRoot('/app/renderer', '/app/renderer')).toBe(false);
		expect(isPathInsideRoot('/app/renderer', '/app/secrets/key.pem')).toBe(false);
		expect(isPathInsideRoot('/app/renderer', '/app/renderer-evil/a.js')).toBe(false);
	});

	it('allows only GET and HEAD methods', () => {
		expect(isAllowedMethod('GET')).toBe(true);
		expect(isAllowedMethod('HEAD')).toBe(true);
		expect(isAllowedMethod('POST')).toBe(false);
		expect(isAllowedMethod('PUT')).toBe(false);
		expect(isAllowedMethod('DELETE')).toBe(false);
	});

	it('parses byte ranges safely and rejects invalid ranges', () => {
		expect(parseByteRange(null, 1000)).toBeNull();
		expect(parseByteRange('bytes=0-99', 1000)).toEqual({ valid: true, start: 0, end: 99 });
		expect(parseByteRange('bytes=500-', 1000)).toEqual({ valid: true, start: 500, end: 999 });
		expect(parseByteRange('bytes=-100', 1000)).toEqual({ valid: true, start: 900, end: 999 });
		expect(parseByteRange('bytes=1200-1300', 1000)).toEqual({ valid: false });
		expect(parseByteRange('bytes=500-100', 1000)).toEqual({ valid: false });
		expect(parseByteRange('items=0-10', 1000)).toEqual({ valid: false });
	});

	it('maps MIME types accurately for JS, WASM, CSS, and media', () => {
		expect(getMimeType('index.html')).toContain('text/html');
		expect(getMimeType('ThreadEventHandler.js')).toContain('text/javascript');
		expect(getMimeType('liblua5.1.wasm')).toBe('application/wasm');
		expect(getMimeType('bgm.mp3')).toBe('audio/mpeg');
		expect(getMimeType('unknown.bin')).toBe('application/octet-stream');
	});

	it('builds CSP header without unsafe-eval while preserving wasm-unsafe-eval', () => {
		const csp = buildCspHeader({
			isDev: false,
			allowedConnectOrigins: ['https://emblem.example.com/api', 'javascript:alert(1)']
		});
		expect(csp).not.toContain("'unsafe-eval'");
		expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
		expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
		expect(csp).toContain('https://emblem.example.com');
		expect(csp).not.toContain('javascript:');
	});
});
