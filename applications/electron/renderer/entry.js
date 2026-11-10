import { buildDesktopROConfig } from './config.js';

async function startDesktopRenderer() {
	const isDev = Boolean(import.meta.env && import.meta.env.DEV);
	window.ROConfig = buildDesktopROConfig({ isDev });

	try {
		await import('src/main.js');
	} catch (err) {
		console.error('Failed to load roBrowser engine:', err);
	}
}

startDesktopRenderer();
