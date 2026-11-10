import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { NetworkDestinationPolicy } from '../../applications/electron/services/network-policy.js';
import { TcpService } from '../../applications/electron/services/tcp-service.js';
import BinaryWriter from 'Utils/BinaryWriter.js';

const servers = [];
afterEach(async () => {
	delete globalThis.window.electronAPI;
	while (servers.length) {
		const srv = servers.pop();
		srv.closeAllConnections?.();
		await new Promise(resolve => srv.close(() => resolve()));
	}
});

function createTcpServer(onConnection) {
	return new Promise(resolve => {
		const srv = net.createServer(onConnection);
		srv.listen(0, '127.0.0.1', () => {
			servers.push(srv);
			resolve({ server: srv, port: srv.address().port });
		});
	});
}

function wireElectronIpcBridge(ownerId = 1) {
	const listeners = new Set();
	const policy = new NetworkDestinationPolicy();
	const tcp = new TcpService({
		policy,
		emitEvent: (targetOwnerId, payload) => {
			if (targetOwnerId !== ownerId) return;
			for (const cb of listeners) {
				cb(payload);
			}
		}
	});

	globalThis.window.electronAPI = {
		isElectron: true,
		network: {
			async registerServers(list) {
				return { ok: true, count: policy.setConfiguredServers(ownerId, list) };
			},
			async open(opts) {
				return tcp.open(ownerId, opts);
			},
			async send(socketId, bytes) {
				return tcp.send(ownerId, socketId, bytes);
			},
			async close(socketId) {
				return tcp.close(ownerId, socketId);
			},
			onEvent(cb) {
				listeners.add(cb);
				return () => listeners.delete(cb);
			}
		}
	};

	return { policy, tcp };
}

describe('NodeSocket + NetworkManager TCP parity (Login -> Char -> Map)', () => {
	it('handles fragmented and coalesced RO packets across server transitions without wsProxy', async () => {
		const loginServer = await createTcpServer(sock => {
			sock.on('data', () => {
				// Simulate PACKET.AC.NOTIFY_BAN (0x0081, 3 bytes) or custom echo
				const w = new BinaryWriter(3);
				w.writeUShort(0x0081);
				w.writeUChar(1);
				// Send 1 byte, pause, send remaining 2 bytes (fragmentation)
				const buf = Buffer.from(w.buffer);
				sock.write(buf.subarray(0, 1));
				setTimeout(() => sock.write(buf.subarray(1)), 10);
			});
		});

		const charServer = await createTcpServer(sock => {
			sock.on('data', () => {
				// Simulate 2 coalesced fixed-length packets back-to-back: 0x0081 (3B) + 0x0081 (3B)
				const w = new BinaryWriter(6);
				w.writeUShort(0x0081);
				w.writeUChar(2);
				w.writeUShort(0x0081);
				w.writeUChar(3);
				sock.write(Buffer.from(w.buffer));
			});
		});

		wireElectronIpcBridge(1);
		const { default: PACKETVER } = await import('Network/PacketVerManager.js');
		PACKETVER.value = 20180620;
		const { default: Network } = await import('Network/NetworkManager.js');
		const { default: PACKET } = await import('Network/PacketStructure.js');
		const { default: NodeSocket } = await import('Network/SocketHelpers/NodeSocket.js');

		expect(NodeSocket.isSupported()).toBe(true);

		await window.electronAPI.network.registerServers([{ address: '127.0.0.1', port: loginServer.port }]);

		const receivedErrors = [];
		Network.hookPacket(PACKET.SC.NOTIFY_BAN, pkt => {
			receivedErrors.push(pkt.ErrorCode);
		});

		// 1. Login connect & fragmented receive
		await new Promise((resolve, reject) => {
			Network.connect(
				'127.0.0.1',
				loginServer.port,
				ok => (ok ? resolve() : reject(new Error('Login connect failed'))),
				false,
				'login'
			);
		});
		Network.send(new ArrayBuffer(4));

		await new Promise(resolve => {
			const t = setInterval(() => {
				if (receivedErrors.length >= 1) {
					clearInterval(t);
					resolve();
				}
			}, 10);
		});
		expect(receivedErrors).toEqual([1]);

		// 2. Transition to Char server (unlisted port authorized by active login session) & coalesced packets
		await new Promise((resolve, reject) => {
			Network.connect(
				'127.0.0.1',
				charServer.port,
				ok => (ok ? resolve() : reject(new Error('Char connect failed'))),
				false,
				'char'
			);
		});
		Network.setPing(() => {});
		Network.send(new ArrayBuffer(4));

		await new Promise(resolve => {
			const t = setInterval(() => {
				if (receivedErrors.length >= 3) {
					clearInterval(t);
					resolve();
				}
			}, 10);
		});
		expect(receivedErrors).toEqual([1, 2, 3]);

		Network.close();
	});

	it('falls back to WebSocket when electronAPI is absent', async () => {
		delete globalThis.window.electronAPI;
		const { default: NodeSocket } = await import('Network/SocketHelpers/NodeSocket.js');
		expect(NodeSocket.isSupported()).toBe(false);
	});
});
