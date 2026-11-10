/**
 * Platform/contracts/AssetProvider.js
 *
 * Minimal shared contract for platform-specific asset providers
 * (Browser GRF/FileSystem/HTTP vs Electron Desktop local VFS).
 */

/**
 * @typedef {Object} AssetInitOptions
 * @property {string|Array|RegExp} [grfList]
 * @property {string} [remoteClient]
 * @property {boolean} [desktopAssetsReady]
 *
 * @typedef {Object} AssetReadResult
 * @property {boolean} found
 * @property {ArrayBuffer|string|null} data - ArrayBuffer bytes or streamable URL (for BGM)
 * @property {string} [source]
 * @property {string} [error]
 *
 * @typedef {Object} AssetProvider
 * @property {(options?: AssetInitOptions) => Promise<{ready: boolean, count: number, stats?: object}>} initialize
 * @property {(filename: string) => Promise<boolean>} exists
 * @property {(regex: RegExp) => Promise<string[]>} search
 * @property {(filename: string) => Promise<AssetReadResult>} getBytes
 * @property {() => Promise<void>} close
 * @property {() => Promise<void>} invalidate
 * @property {() => Promise<object>} getStats
 * @property {() => Promise<Array>} getPriority
 */

export const ASSET_PROVIDER_METHODS = Object.freeze([
	'initialize',
	'exists',
	'search',
	'getBytes',
	'close',
	'invalidate',
	'getStats',
	'getPriority'
]);
