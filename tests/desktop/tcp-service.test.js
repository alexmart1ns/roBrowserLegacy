import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { NetworkDestinationPolicy } from '../../applications/electron/services/network-policy.js';
import { TcpService } from '../../applications/electron/services/tcp-service.js';

const servers = [];
afterEach(async () => {
	while (servers.length) {
		const srv = servers.pop();
		await new Promise(resolve => srv.close(() => resolve()));
	}
});

function listenServer(onConnection) {
	return new Promise(resolve => {
		const srv = net.createServer(onConnection);
		srv.listen(0, '127.0.0.1', () => {
			servers.push(srv);
			resolve({ server: srv, port: srv.address().port });
		});
	});
}

describe('Main-process TcpService integration', () => {
	it('preserves byte order across fragmented and concatenated TCP chunks', async () => {
		const { port } = await listenServer(sock => {
			sock.on('data', async chunk => {
				// Echo back split into odd 1-byte and multi-byte fragments, plus concatenated trailer
				for (let i = 0; i < chunk.length; i += 3) {
					sock.write(chunk.subarray(i, i + 3));
					await new Promise(r => setTimeout(r, 2));
				}
			});
		});

		const policy = new NetworkDestinationPolicy();
		policy.setConfiguredServers(1, [{ address: '127.0.0.1', port }]);

		const events = [];
		const tcp = new TcpService({
			policy,
			emitEvent: (_ownerId, evt) => events.push(evt)
		});

		const opened = await tcp.open(1, { host: '127.0.0.1', port, role: 'login' });
		expect(opened.ok).toBe(true);

		await new Promise(resolve => {
			const timer = setInterval(() => {
				if (events.some(e => e.type === 'connected')) {
					clearInterval(timer);
					resolve();
				}
			}, 5);
		});

		const payload = new Uint8Array(64);
		for (let i = 0; i < payload.length; i++) {
			payload[i] = (i * 7) & 0xff;
		}
		expect(tcp.send(1, opened.socketId, payload).ok).toBe(true);

		await new Promise(resolve => {
			const timer = setInterval(() => {
				const total = events
					.filter(e => e.type === 'data')
					.reduce((acc, e) => acc + e.data.byteLength, 0);
				if (total >= payload.length) {
					clearInterval(timer);
					resolve();
				}
			}, 5);
		});

		const received = Buffer.concat(events.filter(e => e.type === 'data').map(e => Buffer.from(e.data)));
		expect(new Uint8Array(received)).toEqual(payload);
		// Every emitted data chunk must have zero byteOffset
		for (const evt of events.filter(e => e.type === 'data')) {
			expect(evt.data.byteOffset).toBe(0);
			expect(evt.data.byteLength).toBe(evt.data.buffer.byteLength);
		}

		tcp.close(1, opened.socketId);
		await new Promise(r => setTimeout(r, 25));

		expect(events.filter(e => e.type === 'connected').length).toBe(1);
		expect(events.filter(e => e.type === 'closed').length).toBe(1);
		expect(tcp.send(1, opened.socketId, new Uint8Array([1])).ok).toBe(false);
	});

	it('handles connection refused without duplicate error or spurious closed event', async () => {
		// Bind and close an ephemeral port to guarantee connection refused
		const { server, port } = await listenServer(() => {});
		await new Promise(resolve => server.close(() => resolve()));
		servers.pop();

		const policy = new NetworkDestinationPolicy();
		policy.setConfiguredServers(1, [{ address: '127.0.0.1', port }]);

		const events = [];
		const tcp = new TcpService({
			policy,
			emitEvent: (_ownerId, evt) => events.push(evt)
		});

		const opened = await tcp.open(1, { host: '127.0.0.1', port, role: 'login' });
		expect(opened.ok).toBe(true);

		await new Promise(resolve => {
			const timer = setInterval(() => {
				if (events.some(e => e.type === 'error')) {
					clearInterval(timer);
					resolve();
				}
			}, 10);
		});
		await new Promise(r => setTimeout(r, 30));

		expect(events.filter(e => e.type === 'connected').length).toBe(0);
		expect(events.filter(e => e.type === 'error').length).toBe(1);
		expect(events.filter(e => e.type === 'closed').length).toBe(0);
		expect(tcp.getActiveSocketCount()).toBe(0);
	});

	it('enforces DNS lookup blocking, connect timeout, and owner teardown', async () => {
		const policy = new NetworkDestinationPolicy();
		policy.setConfiguredServers(1, [{ address: 'rebind.example', port: 6900 }]);

		const events = [];
		const tcpBlockedDns = new TcpService({
			policy,
			emitEvent: (_ownerId, evt) => events.push(evt),
			lookupFn: async () => ({ address: '169.254.169.254', family: 4 })
		});
		const dnsBlocked = await tcpBlockedDns.open(1, { host: 'rebind.example', port: 6900, role: 'login' });
		expect(dnsBlocked.ok).toBe(false);
		expect(dnsBlocked.code).toBe('ERR_POLICY_BLOCKED_IP');

		const dnsErrSvc = new TcpService({
			policy,
			emitEvent: (_ownerId, evt) => events.push(evt),
			lookupFn: async () => {
				const err = new Error('not found');
				err.code = 'ENOTFOUND';
				throw err;
			}
		});
		const dnsFail = await dnsErrSvc.open(1, { host: 'rebind.example', port: 6900, role: 'login' });
		expect(dnsFail.ok).toBe(false);
		expect(dnsFail.code).toBe('ENOTFOUND');

		// Test timeout & destroyOwnerSockets with a silent unaccepted socket
		const silentServer = net.createServer(() => {});
		await new Promise(resolve => silentServer.listen(0, '127.0.0.1', resolve));
		servers.push(silentServer);
		const port = silentServer.address().port;

		policy.setConfiguredServers(2, [{ address: '127.0.0.1', port }]);
		const timeoutEvents = [];
		const tcpTimeout = new TcpService({
			policy,
			emitEvent: (_ownerId, evt) => timeoutEvents.push(evt),
			connectTimeoutMs: 40
		});
		const res = await tcpTimeout.open(2, { host: '127.0.0.1', port, role: 'login' });
		expect(res.ok).toBe(true);
		tcpTimeout.destroyOwnerSockets(2);
		expect(tcpTimeout.getActiveSocketCount()).toBe(0);
	});
});
