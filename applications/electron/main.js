import { startApp } from './main/bootstrap.js';

startApp().catch(err => {
	console.error('[Electron] Fatal startup error:', err);
	process.exit(1);
});
