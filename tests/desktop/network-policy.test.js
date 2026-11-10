import { describe, it, expect } from 'vitest';
import {
	isBlockedIpAddress,
	isBlockedRedirectPort,
	NetworkDestinationPolicy
} from '../../applications/electron/services/network-policy.js';

describe('NetworkDestinationPolicy', () => {
	it('identifies blocked metadata, unspecified, link-local, and multicast IP addresses', () => {
		expect(isBlockedIpAddress('169.254.169.254')).toBe(true);
		expect(isBlockedIpAddress('0.0.0.0')).toBe(true);
		expect(isBlockedIpAddress('224.0.0.1')).toBe(true);
		expect(isBlockedIpAddress('::')).toBe(true);
		expect(isBlockedIpAddress('fe80::1')).toBe(true);
		expect(isBlockedIpAddress('::ffff:169.254.169.254')).toBe(true);
		expect(isBlockedIpAddress('127.0.0.1')).toBe(false);
		expect(isBlockedIpAddress('192.168.1.50')).toBe(false);
	});

	it('blocks dangerous service ports on redirects', () => {
		expect(isBlockedRedirectPort(22)).toBe(true);
		expect(isBlockedRedirectPort(80)).toBe(true);
		expect(isBlockedRedirectPort(443)).toBe(true);
		expect(isBlockedRedirectPort(445)).toBe(true);
		expect(isBlockedRedirectPort(3306)).toBe(true);
		expect(isBlockedRedirectPort(5121)).toBe(false);
		expect(isBlockedRedirectPort(6121)).toBe(false);
		expect(isBlockedRedirectPort(6900)).toBe(false);
	});

	it('requires configured login server and active session for char/map redirects', () => {
		const policy = new NetworkDestinationPolicy();
		const owner = 1;

		// Unconfigured login host denied
		expect(policy.authorizeConnection(owner, { host: '127.0.0.1', port: 6900, role: 'login' }).allowed).toBe(false);

		// Redirect without active session denied
		expect(policy.authorizeConnection(owner, { host: '10.0.0.5', port: 6121, role: 'char' }).allowed).toBe(false);

		// Configure login server
		policy.setConfiguredServers(owner, [{ address: '127.0.0.1', port: 6900 }]);
		expect(policy.authorizeConnection(owner, { host: '127.0.0.1', port: 6900, role: 'login' }).allowed).toBe(true);

		// Mark login socket connected -> char and map redirects authorized across zone IPs
		policy.markSocketConnected(owner, 10);
		expect(policy.authorizeConnection(owner, { host: '203.0.113.10', port: 6121, role: 'char' }).allowed).toBe(true);
		expect(policy.authorizeConnection(owner, { host: '203.0.113.11', port: 5121, role: 'map' }).allowed).toBe(true);

		// Metadata IP and SSH port remain blocked even during active session
		expect(policy.authorizeConnection(owner, { host: '169.254.169.254', port: 6121, role: 'map' }).allowed).toBe(
			false
		);
		expect(policy.authorizeConnection(owner, { host: '203.0.113.11', port: 22, role: 'map' }).allowed).toBe(false);

		// Clear owner wipes session & config
		policy.clearOwner(owner);
		expect(policy.authorizeConnection(owner, { host: '127.0.0.1', port: 6900, role: 'login' }).allowed).toBe(false);
		expect(policy.authorizeConnection(owner, { host: '203.0.113.11', port: 5121, role: 'map' }).allowed).toBe(false);
	});
});
