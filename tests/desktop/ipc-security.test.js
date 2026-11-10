import { describe, it, expect } from 'vitest';
import {
	assertValidIpcSender,
	isValidRendererOrigin,
	MAX_IPC_PACKET_BYTES,
	toTightUint8Array,
	validateExternalUrl,
	validateOpenSocketPayload,
	validateSocketId
} from '../../applications/electron/main/ipc-security.js';

describe('Electron IPC security validation', () => {
	it('validates renderer frame origin strictly', () => {
		expect(isValidRendererOrigin('app://robrowser/index.html')).toBe(true);
		expect(isValidRendererOrigin('app://evil.com/index.html')).toBe(false);
		expect(isValidRendererOrigin('https://robrowser.com/')).toBe(false);
		expect(isValidRendererOrigin('http://localhost:3000/index.html', { isDev: false })).toBe(false);
		expect(
			isValidRendererOrigin('http://localhost:3000/applications/electron/renderer/index.html', {
				isDev: true,
				devOrigin: 'http://localhost:3000'
			})
		).toBe(true);
	});

	it('rejects subframes and untrusted origins in assertValidIpcSender', () => {
		const mainFrame = { url: 'app://robrowser/index.html' };
		const subFrame = { url: 'app://robrowser/index.html' };
		const evilFrame = { url: 'https://evil.example/' };

		expect(assertValidIpcSender({ senderFrame: mainFrame, sender: { id: 7, mainFrame } })).toBe(7);
		expect(() => assertValidIpcSender({ senderFrame: subFrame, sender: { id: 7, mainFrame } })).toThrow(
			'IPC_SUBFRAME_DENIED'
		);
		expect(() =>
			assertValidIpcSender({
				senderFrame: evilFrame,
				sender: { id: 7, mainFrame: evilFrame }
			})
		).toThrow('IPC_ORIGIN_DENIED');
		expect(() => assertValidIpcSender({})).toThrow('IPC_INVALID_SENDER');
	});

	it('validates external URLs for shell.openExternal', () => {
		expect(validateExternalUrl('https://github.com/MrAntares/roBrowserLegacy').ok).toBe(true);
		expect(validateExternalUrl('http://www.robrowser.com/').ok).toBe(true);
		expect(validateExternalUrl('file:///C:/Windows/System32/calc.exe').ok).toBe(false);
		expect(validateExternalUrl('javascript:alert(1)').ok).toBe(false);
		expect(validateExternalUrl('https://user:pass@example.com/').ok).toBe(false);
		expect(validateExternalUrl('').ok).toBe(false);
	});

	it('validates open socket payloads and socket IDs', () => {
		expect(validateSocketId(1)).toBe(1);
		expect(validateSocketId(0)).toBeNull();
		expect(validateSocketId(-5)).toBeNull();
		expect(validateSocketId('1')).toBeNull();

		expect(validateOpenSocketPayload({ host: '127.0.0.1', port: 6900, role: 'login' })).toEqual({
			ok: true,
			host: '127.0.0.1',
			port: 6900,
			role: 'login'
		});
		expect(validateOpenSocketPayload({ host: 'bad host', port: 6900 }).ok).toBe(false);
		expect(validateOpenSocketPayload({ host: '127.0.0.1', port: 0 }).ok).toBe(false);
		expect(validateOpenSocketPayload({ host: '127.0.0.1', port: 70000 }).ok).toBe(false);
		expect(validateOpenSocketPayload({ host: '127.0.0.1', port: 6900, role: 'admin' }).ok).toBe(false);
	});

	it('normalizes binary payloads with byteOffset and enforces size limits', () => {
		const slab = new Uint8Array([99, 1, 2, 3, 4, 88]);
		const sliced = slab.subarray(1, 5);
		const tight = toTightUint8Array(sliced);
		expect(tight.ok).toBe(true);
		expect(Array.from(tight.bytes)).toEqual([1, 2, 3, 4]);
		expect(tight.bytes.byteOffset).toBe(0);
		expect(tight.bytes.buffer.byteLength).toBe(4);

		expect(toTightUint8Array(new Uint8Array(0)).ok).toBe(false);
		expect(toTightUint8Array(new Uint8Array(MAX_IPC_PACKET_BYTES + 1)).ok).toBe(false);
		expect(toTightUint8Array({ fake: true }).ok).toBe(false);
	});
});
