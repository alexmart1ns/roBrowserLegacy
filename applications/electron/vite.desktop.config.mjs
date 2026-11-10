import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const rendererRoot = path.resolve(__dirname, 'renderer');

export const desktopAliases = {
	jquery: path.resolve(projectRoot, 'src/Vendors/jquery-1.9.1.js'),
	App: path.resolve(projectRoot, 'src/App'),
	Audio: path.resolve(projectRoot, 'src/Audio'),
	Controls: path.resolve(projectRoot, 'src/Controls'),
	Core: path.resolve(projectRoot, 'src/Core'),
	DB: path.resolve(projectRoot, 'src/DB'),
	Engine: path.resolve(projectRoot, 'src/Engine'),
	Loaders: path.resolve(projectRoot, 'src/Loaders'),
	Network: path.resolve(projectRoot, 'src/Network'),
	Plugins: path.resolve(projectRoot, 'src/Plugins'),
	Preferences: path.resolve(projectRoot, 'src/Preferences'),
	Renderer: path.resolve(projectRoot, 'src/Renderer'),
	UI: path.resolve(projectRoot, 'src/UI'),
	Utils: path.resolve(projectRoot, 'src/Utils'),
	Vendors: path.resolve(projectRoot, 'src/Vendors'),
	src: path.resolve(projectRoot, 'src')
};

export default defineConfig({
	root: rendererRoot,
	base: './',
	publicDir: false,
	resolve: {
		alias: desktopAliases
	},
	optimizeDeps: {
		include: ['bson', 'lodash', 'rijndael-js']
	},
	worker: {
		format: 'es'
	},
	build: {
		outDir: path.resolve(projectRoot, 'dist/DesktopRenderer'),
		emptyOutDir: true,
		sourcemap: false,
		minify: false,
		assetsInlineLimit: 4096,
		rollupOptions: {
			input: {
				main: path.resolve(rendererRoot, 'index.html')
			}
		}
	}
});
