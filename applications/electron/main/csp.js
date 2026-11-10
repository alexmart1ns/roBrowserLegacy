/**
 * Content Security Policy builder for Electron Desktop renderer.
 * Avoids 'unsafe-eval' and blocks remote script execution.
 */
export function buildCspHeader({
	isDev = false,
	devOrigin = 'http://localhost:3000',
	allowedConnectOrigins = []
} = {}) {
	const connectSources = new Set(["'self'", 'ro-asset:', 'data:', 'blob:']);
	const scriptSources = ["'self'", "'wasm-unsafe-eval'"];
	const styleSources = ["'self'", "'unsafe-inline'"];
	const imgSources = ["'self'", 'data:', 'blob:', 'ro-asset:'];
	const mediaSources = ["'self'", 'data:', 'blob:', 'ro-asset:'];
	const fontSources = ["'self'", 'data:', 'blob:'];
	const workerSources = ["'self'", 'blob:'];

	if (isDev && devOrigin) {
		try {
			const parsed = new URL(devOrigin);
			connectSources.add(parsed.origin);
			connectSources.add(parsed.origin.replace(/^http/, 'ws'));
		} catch {
			// Ignore malformed devOrigin
		}
	}

	for (const rawOrigin of allowedConnectOrigins) {
		if (!rawOrigin || typeof rawOrigin !== 'string') {
			continue;
		}
		try {
			const parsed = new URL(rawOrigin);
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
				connectSources.add(parsed.origin);
			}
		} catch {
			// Ignore invalid origin
		}
	}

	const directives = [
		"default-src 'self'",
		`script-src ${scriptSources.join(' ')}`,
		`worker-src ${workerSources.join(' ')}`,
		`style-src ${styleSources.join(' ')}`,
		`img-src ${imgSources.join(' ')}`,
		`media-src ${mediaSources.join(' ')}`,
		`font-src ${fontSources.join(' ')}`,
		`connect-src ${Array.from(connectSources).join(' ')}`,
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
		"form-action 'self'"
	];

	return directives.join('; ');
}
