import { describe, it, expect, afterEach } from 'vitest';
import { DesktopAssetProvider } from 'Platform/desktop/DesktopAssetProvider.js';
import FileManager from 'Core/FileManager.js';

describe('DesktopAssetProvider & FileManager integration', () => {
	const originalProvider = FileManager.desktopProvider;
	const originalRemote = FileManager.remoteClient;

	afterEach(() => {
		FileManager.desktopProvider = originalProvider;
		FileManager.remoteClient = originalRemote;
	});

	it('initializes, checks existence, searches, and reads bytes via ro-asset:// without HTTP remoteClient', async () => {
		const calls = [];
		const mockFetch = async (url, init = {}) => {
			calls.push({ url, method: init.method || 'GET' });
			if (url === 'ro-asset://local/status') {
				return new Response(
					JSON.stringify({
						configured: true,
						grfCount: 1,
						looseCount: 2,
						priority: [{ type: 'loose', name: 'Loose', priority: 0 }]
					}),
					{ status: 200 }
				);
			}
			if (url === 'ro-asset://local/search' && init.method === 'POST') {
				return new Response(JSON.stringify(['data\\prontera.rsw']), { status: 200 });
			}
			if (url.startsWith('ro-asset://local/asset/BGM/01.mp3') && init.method === 'HEAD') {
				return new Response(null, { status: 200 });
			}
			if (url.startsWith('ro-asset://local/asset/data/test.txt')) {
				return new Response(new Uint8Array([72, 73]), { status: 200 });
			}
			return new Response('Not Found', { status: 404 });
		};

		const provider = new DesktopAssetProvider({ fetchImpl: mockFetch });
		const initRes = await provider.initialize();
		expect(initRes.ready).toBe(true);
		expect(initRes.count).toBe(2);

		// BGM returns streamable ro-asset URL rather than buffering whole MP3
		const bgm = await provider.getBytes('BGM/01.mp3');
		expect(bgm.found).toBe(true);
		expect(bgm.data).toBe('ro-asset://local/asset/BGM/01.mp3');

		// Binary file returns ArrayBuffer
		FileManager.desktopProvider = provider;
		FileManager.remoteClient = '';

		const fileBytes = await new Promise((resolve, reject) => {
			FileManager.get('data\\test.txt', (buf, err) => {
				if (err) reject(new Error(err));
				else resolve(new Uint8Array(buf));
			});
		});
		expect(Array.from(fileBytes)).toEqual([72, 73]);

		// Missing file when remoteClient is empty fails cleanly WITHOUT requesting /client/
		const missingRes = await new Promise(resolve => {
			FileManager.get('data\\does_not_exist.txt', (buf, err) => resolve({ buf, err }));
		});
		expect(missingRes.buf).toBeNull();
		expect(missingRes.err).toBe("Can't get file");
		expect(calls.some(c => c.url.includes('/client/'))).toBe(false);

		// Search works asynchronously
		const searchRes = await FileManager.searchAsync(/prontera/i);
		expect(searchRes).toEqual(['data\\prontera.rsw']);
	});
});
