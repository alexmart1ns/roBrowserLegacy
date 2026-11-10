import { isAssetsReady, resolveActiveServer } from './config.js';

const STATIC_TEMPLATE = `
	<header class="dl-header">
		<div class="dl-brand">
			<img class="dl-logo" src="../icon.png" alt="roBrowserLegacy" />
			<div>
				<h1 class="dl-title">roBrowserLegacy Desktop</h1>
				<div class="dl-subtitle" id="dl-version">Desktop Client</div>
			</div>
		</div>
		<div class="dl-badges">
			<span class="dl-pill" id="dl-pill-assets" data-tone="warn">Assets: Not Selected</span>
			<span class="dl-pill" id="dl-pill-packetver">PACKETVER: executable</span>
			<span class="dl-pill" id="dl-pill-server" data-tone="warn">Server: None</span>
		</div>
	</header>

	<nav class="dl-tabs" role="tablist">
		<button class="dl-tab" id="dl-tab-setup" role="tab" aria-selected="true" data-tab="setup">Assets &amp; Servers</button>
		<button class="dl-tab" id="dl-tab-prefs" role="tab" aria-selected="false" data-tab="preferences">Graphics &amp; Audio</button>
		<button class="dl-tab" id="dl-tab-updates" role="tab" aria-selected="false" data-tab="updates">Updates &amp; Diagnostics</button>
	</nav>

	<main class="dl-body">
		<section class="dl-panel is-active" id="dl-panel-setup" data-panel="setup">
			<article class="dl-card">
				<h2 class="dl-card-title">
					<span>1. Ragnarok Client Assets</span>
				</h2>
				<div class="dl-path-box" id="dl-assets-path">No directory selected</div>
				<div class="dl-row">
					<button class="dl-btn" id="dl-assets-select" type="button">Select Client Folder...</button>
					<button class="dl-btn" id="dl-assets-reindex" type="button">Reindex</button>
					<button class="dl-btn" id="dl-assets-clear" type="button">Clear Cache</button>
				</div>
				<div class="dl-progress-wrap dl-hidden" id="dl-assets-progress-wrap">
					<div class="dl-progress-bar">
						<div class="dl-progress-fill" id="dl-assets-progress-fill"></div>
					</div>
					<div class="dl-subtitle" id="dl-assets-progress-text">Indexing...</div>
				</div>
				<div class="dl-alert dl-alert-info" id="dl-assets-summary">Select your Ragnarok Online client directory (GRF / DATA.INI / data/).</div>
				<div class="dl-alert dl-alert-warn dl-hidden" id="dl-assets-warnings"></div>
			</article>

			<article class="dl-card">
				<h2 class="dl-card-title">
					<span>2. Game Servers</span>
				</h2>
				<div class="dl-server-list" id="dl-server-list"></div>
				<div class="dl-alert dl-alert-err dl-hidden" id="dl-srv-error"></div>
				<div class="dl-grid-2">
					<div class="dl-field">
						<label for="dl-srv-display">Server Name</label>
						<input id="dl-srv-display" type="text" placeholder="My Ragnarok Server" maxlength="64" />
					</div>
					<div class="dl-field">
						<label for="dl-srv-packetver">PACKETVER (YYYYMMDD or executable)</label>
						<input id="dl-srv-packetver" type="text" placeholder="executable" value="executable" />
					</div>
					<div class="dl-field">
						<label for="dl-srv-address">Host / IP</label>
						<input id="dl-srv-address" type="text" placeholder="127.0.0.1" maxlength="255" />
					</div>
					<div class="dl-field">
						<label for="dl-srv-port">Login Port</label>
						<input id="dl-srv-port" type="number" min="1" max="65535" value="6900" />
					</div>
					<div class="dl-field">
						<label for="dl-srv-version">Client Version</label>
						<input id="dl-srv-version" type="number" value="55" />
					</div>
					<div class="dl-field">
						<label for="dl-srv-langtype">Langtype</label>
						<input id="dl-srv-langtype" type="number" value="1" />
					</div>
					<div class="dl-field">
						<label for="dl-srv-webserver">Webserver URL (optional, emblems/config)</label>
						<input id="dl-srv-webserver" type="url" placeholder="https://example.org" />
					</div>
					<div class="dl-field">
						<label for="dl-srv-remote-client">Remote Client Fallback URL (optional)</label>
						<input id="dl-srv-remote-client" type="url" placeholder="https://assets.example.org/" />
					</div>
				</div>
				<div class="dl-row">
					<label class="dl-checkbox"><input id="dl-srv-renewal" type="checkbox" /> Renewal</label>
					<label class="dl-checkbox"><input id="dl-srv-force-address" type="checkbox" /> Force Login Host</label>
				</div>
				<div class="dl-row">
					<button class="dl-btn" id="dl-srv-save" type="button">Add / Update Server</button>
					<button class="dl-btn" id="dl-srv-clear" type="button">New Entry</button>
				</div>
			</article>
		</section>

		<section class="dl-panel" id="dl-panel-preferences" data-panel="preferences">
			<article class="dl-card">
				<h2 class="dl-card-title"><span>Display &amp; Performance</span></h2>
				<div class="dl-grid-2">
					<div class="dl-field">
						<label for="dl-pref-screensize">Resolution</label>
						<select id="dl-pref-screensize">
							<option value="800x600">800 x 600</option>
							<option value="1024x768">1024 x 768</option>
							<option value="1280x800">1280 x 800</option>
							<option value="1400x900">1400 x 900</option>
							<option value="1680x1050">1680 x 1050</option>
							<option value="full">Fullscreen</option>
						</select>
					</div>
					<div class="dl-field">
						<label for="dl-pref-fpslimit">FPS Limit</label>
						<select id="dl-pref-fpslimit">
							<option value="30">30 FPS</option>
							<option value="60">60 FPS</option>
							<option value="120">120 FPS</option>
							<option value="144">144 FPS</option>
							<option value="0">Unlimited</option>
						</select>
					</div>
					<div class="dl-field">
						<label for="dl-pref-quality">Render Quality (<span id="dl-pref-quality-val">100</span>%)</label>
						<input id="dl-pref-quality" type="range" min="25" max="100" step="5" value="100" />
					</div>
				</div>
				<div class="dl-row">
					<label class="dl-checkbox"><input id="dl-pref-fullscreen" type="checkbox" /> Fullscreen</label>
					<label class="dl-checkbox"><input id="dl-pref-cursor" type="checkbox" /> Custom Game Cursor</label>
				</div>
				<div class="dl-row">
					<button class="dl-btn" id="dl-pref-apply-window" type="button">Apply Window Size Now</button>
				</div>
			</article>

			<article class="dl-card">
				<h2 class="dl-card-title"><span>Audio &amp; Startup Behavior</span></h2>
				<div class="dl-grid-2">
					<div class="dl-field">
						<label for="dl-pref-bgm-vol">BGM Volume (<span id="dl-pref-bgm-val">50</span>%)</label>
						<input id="dl-pref-bgm-vol" type="range" min="0" max="100" step="5" value="50" />
					</div>
					<div class="dl-field">
						<label for="dl-pref-sfx-vol">SFX Volume (<span id="dl-pref-sfx-val">50</span>%)</label>
						<input id="dl-pref-sfx-vol" type="range" min="0" max="100" step="5" value="50" />
					</div>
				</div>
				<div class="dl-row">
					<label class="dl-checkbox"><input id="dl-pref-bgm-enabled" type="checkbox" /> Enable BGM</label>
					<label class="dl-checkbox"><input id="dl-pref-sfx-enabled" type="checkbox" /> Enable Sound Effects</label>
				</div>
				<div class="dl-row">
					<label class="dl-checkbox"><input id="dl-pref-skip-intro" type="checkbox" /> Skip Intro when ready</label>
					<label class="dl-checkbox"><input id="dl-pref-auto-launch" type="checkbox" /> Auto-launch on startup</label>
				</div>
			</article>
		</section>

		<section class="dl-panel" id="dl-panel-updates" data-panel="updates">
			<article class="dl-card">
				<h2 class="dl-card-title"><span>Update Channels &amp; Patcher</span></h2>
				<div class="dl-grid-2">
					<div class="dl-field">
						<label for="dl-upd-channel">Release Channel</label>
						<select id="dl-upd-channel">
							<option value="stable">Stable</option>
							<option value="beta">Beta</option>
						</select>
					</div>
					<div class="dl-field">
						<label for="dl-upd-app-feed">App Update Feed URL</label>
						<input id="dl-upd-app-feed" type="url" placeholder="https://updates.example.org/app/" />
					</div>
				</div>
				<div class="dl-field">
					<label for="dl-upd-manifest">Asset Patch Manifest URL</label>
					<input id="dl-upd-manifest" type="url" placeholder="https://updates.example.org/manifest.json" />
				</div>
				<div class="dl-row">
					<button class="dl-btn" id="dl-upd-save" type="button">Save Update Settings</button>
				</div>
				<div id="dl-updates-slot"></div>
			</article>

			<article class="dl-card">
				<h2 class="dl-card-title"><span>Diagnostics &amp; Logs</span></h2>
				<div class="dl-row">
					<label class="dl-checkbox"><input id="dl-diag-debug" type="checkbox" /> Enable Debug File Logging</label>
				</div>
				<div class="dl-row">
					<button class="dl-btn" id="dl-diag-preview-btn" type="button">Preview Snapshot</button>
					<button class="dl-btn" id="dl-diag-export-btn" type="button">Export Diagnostics JSON...</button>
				</div>
				<pre class="dl-pre dl-hidden" id="dl-diag-preview"></pre>
			</article>
		</section>
	</main>

	<footer class="dl-footer">
		<div class="dl-row">
			<button class="dl-btn dl-btn-danger" id="dl-reset-btn" type="button">Reset Defaults</button>
			<span class="dl-status-msg" id="dl-status-msg"></span>
		</div>
		<button class="dl-btn dl-btn-primary" id="launcher-play" type="button">Launch Game</button>
	</footer>
`;

export function mountDesktopLauncher({ platformInfo, initialSettings, initialAssetsStatus, onLaunch }) {
	const existing = document.getElementById('desktop-launcher');
	if (existing) {
		existing.remove();
	}

	const container = document.createElement('section');
	container.id = 'desktop-launcher';
	container.innerHTML = STATIC_TEMPLATE;
	document.body.appendChild(container);

	const q = id => container.querySelector(`#${id}`);
	let settings = structuredClone(initialSettings);
	let assetsStatus = initialAssetsStatus || { ready: false };
	let editingServerId = null;
	let resetArmed = false;
	let resetTimer = null;

	const setStatusMessage = (msg, isError = false) => {
		const el = q('dl-status-msg');
		el.textContent = msg || '';
		el.style.color = isError ? '#fecaca' : '#cbd5e1';
	};

	const renderHeaderBadges = () => {
		q('dl-version').textContent =
			`Desktop Client v${platformInfo?.appVersion || '0.0.0'} (${platformInfo?.platform || 'desktop'} ${platformInfo?.arch || ''})`;

		const assetsPill = q('dl-pill-assets');
		const totalFiles = (assetsStatus?.totalGrfEntries || 0) + (assetsStatus?.looseCount || 0);
		if (isAssetsReady(assetsStatus)) {
			assetsPill.textContent = `Assets: Ready (${totalFiles} files)`;
			assetsPill.dataset.tone = 'ok';
		} else {
			assetsPill.textContent = 'Assets: Not Ready';
			assetsPill.dataset.tone = 'warn';
		}

		const active = resolveActiveServer(settings);
		const srvPill = q('dl-pill-server');
		if (active) {
			srvPill.textContent = `Server: ${active.display}`;
			srvPill.dataset.tone = 'ok';
		} else {
			srvPill.textContent = 'Server: None';
			srvPill.dataset.tone = 'warn';
		}

		const effectiveVer =
			active?.packetver && active.packetver !== 'executable'
				? active.packetver
				: assetsStatus?.detectedPacketVer || active?.packetver || 'executable';
		q('dl-pill-packetver').textContent = `PACKETVER: ${effectiveVer}`;
	};

	const renderAssetsSection = () => {
		q('dl-assets-path').textContent =
			assetsStatus?.rootDir || settings.assets?.directory || 'No directory selected';

		const summary = q('dl-assets-summary');
		const warnings = q('dl-assets-warnings');

		if (assetsStatus?.configured) {
			const grfMounts = (assetsStatus.priority || []).filter(item => item.type === 'grf');
			const grfLabel =
				grfMounts.length > 0 ? grfMounts.map(g => `${g.name} (${g.entryCount})`).join(' -> ') : 'none';
			const sourceLabel = grfMounts[0]?.prioritySource || 'none';
			summary.textContent = `GRF priority [${sourceLabel}]: ${grfLabel} | Loose files: ${assetsStatus.looseCount || 0} | Overrides: ${assetsStatus.conflictCount || 0}`;
		} else {
			summary.textContent = 'Select your Ragnarok Online client directory (GRF / DATA.INI / data/).';
		}

		const warnList = [];
		if (assetsStatus?.configured && !isAssetsReady(assetsStatus)) {
			warnList.push('No readable GRF or data/ entries detected in selected folder.');
		}
		if (Array.isArray(assetsStatus?.missingGrfs) && assetsStatus.missingGrfs.length > 0) {
			warnList.push(
				`Missing/invalid GRFs: ${assetsStatus.missingGrfs.map(m => `${m.name} (${m.reason})`).join(', ')}`
			);
		}
		if (warnList.length > 0) {
			warnings.textContent = warnList.join(' | ');
			warnings.classList.remove('dl-hidden');
		} else {
			warnings.textContent = '';
			warnings.classList.add('dl-hidden');
		}
	};

	const clearServerForm = () => {
		editingServerId = null;
		q('dl-srv-display').value = '';
		q('dl-srv-address').value = '';
		q('dl-srv-port').value = '6900';
		q('dl-srv-packetver').value = 'executable';
		q('dl-srv-version').value = '55';
		q('dl-srv-langtype').value = '1';
		q('dl-srv-webserver').value = '';
		q('dl-srv-remote-client').value = '';
		q('dl-srv-renewal').checked = false;
		q('dl-srv-force-address').checked = false;
		q('dl-srv-error').classList.add('dl-hidden');
		q('dl-srv-error').textContent = '';
	};

	const populateServerForm = srv => {
		editingServerId = srv.id;
		q('dl-srv-display').value = srv.display || '';
		q('dl-srv-address').value = srv.address || '';
		q('dl-srv-port').value = String(srv.port || 6900);
		q('dl-srv-packetver').value = String(srv.packetver || 'executable');
		q('dl-srv-version').value = String(srv.version ?? 55);
		q('dl-srv-langtype').value = String(srv.langtype ?? 1);
		q('dl-srv-webserver').value = srv.webserverAddress || '';
		q('dl-srv-remote-client').value = srv.remoteClient || '';
		q('dl-srv-renewal').checked = Boolean(srv.renewal);
		q('dl-srv-force-address').checked = Boolean(srv.forceUseAddress);
		q('dl-srv-error').classList.add('dl-hidden');
	};

	const renderServerList = () => {
		const listEl = q('dl-server-list');
		listEl.replaceChildren();
		const servers = settings.servers || [];
		if (servers.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'dl-alert dl-alert-info';
			empty.textContent = 'No servers configured yet. Add your Ragnarok server below.';
			listEl.appendChild(empty);
			return;
		}

		for (const srv of servers) {
			const item = document.createElement('div');
			item.className = 'dl-server-item';
			if (srv.id === settings.activeServerId) {
				item.classList.add('is-active');
			}

			const meta = document.createElement('div');
			meta.className = 'dl-server-meta';
			const title = document.createElement('div');
			title.className = 'dl-server-name';
			title.textContent = srv.id === settings.activeServerId ? `${srv.display} (Active)` : srv.display;
			const sub = document.createElement('div');
			sub.className = 'dl-server-sub';
			sub.textContent = `${srv.address}:${srv.port} | PV:${srv.packetver} | Lang:${srv.langtype}`;
			meta.appendChild(title);
			meta.appendChild(sub);

			const actions = document.createElement('div');
			actions.className = 'dl-row';

			const useBtn = document.createElement('button');
			useBtn.className = 'dl-btn';
			useBtn.type = 'button';
			useBtn.textContent = 'Select';
			useBtn.disabled = srv.id === settings.activeServerId;
			useBtn.addEventListener('click', async () => {
				settings = await window.electronAPI.settings.save({ activeServerId: srv.id });
				renderAll();
				setStatusMessage(`Active server set to ${srv.display}.`);
			});

			const editBtn = document.createElement('button');
			editBtn.className = 'dl-btn';
			editBtn.type = 'button';
			editBtn.textContent = 'Edit';
			editBtn.addEventListener('click', () => {
				populateServerForm(srv);
			});

			const delBtn = document.createElement('button');
			delBtn.className = 'dl-btn dl-btn-danger';
			delBtn.type = 'button';
			delBtn.textContent = 'Remove';
			delBtn.addEventListener('click', async () => {
				const nextServers = settings.servers.filter(s => s.id !== srv.id);
				const nextActive =
					settings.activeServerId === srv.id ? nextServers[0]?.id || null : settings.activeServerId;
				settings = await window.electronAPI.settings.save({
					servers: nextServers,
					activeServerId: nextActive
				});
				if (editingServerId === srv.id) {
					clearServerForm();
				}
				renderAll();
				setStatusMessage(`Removed server "${srv.display}".`);
			});

			actions.appendChild(useBtn);
			actions.appendChild(editBtn);
			actions.appendChild(delBtn);
			item.appendChild(meta);
			item.appendChild(actions);
			listEl.appendChild(item);
		}
	};

	const renderPreferencesSection = () => {
		const p = settings.preferences;
		q('dl-pref-screensize').value = p.screensize || '1024x768';
		q('dl-pref-fullscreen').checked = Boolean(p.fullscreen);
		q('dl-pref-quality').value = String(p.quality ?? 100);
		q('dl-pref-quality-val').textContent = String(p.quality ?? 100);
		q('dl-pref-fpslimit').value = String(p.fpslimit ?? 60);
		q('dl-pref-cursor').checked = p.showCursor !== false;

		q('dl-pref-bgm-enabled').checked = p.bgmEnabled !== false;
		const bgmPct = Math.round((p.bgmVolume ?? 0.5) * 100);
		q('dl-pref-bgm-vol').value = String(bgmPct);
		q('dl-pref-bgm-val').textContent = String(bgmPct);

		q('dl-pref-sfx-enabled').checked = p.soundEnabled !== false;
		const sfxPct = Math.round((p.soundVolume ?? 0.5) * 100);
		q('dl-pref-sfx-vol').value = String(sfxPct);
		q('dl-pref-sfx-val').textContent = String(sfxPct);

		q('dl-pref-skip-intro').checked = settings.launcher?.skipIntroWhenReady !== false;
		q('dl-pref-auto-launch').checked = Boolean(settings.launcher?.autoLaunch);
	};

	const renderUpdatesAndDiagnostics = () => {
		q('dl-upd-channel').value = settings.updates?.channel === 'beta' ? 'beta' : 'stable';
		q('dl-upd-app-feed').value = settings.updates?.appFeedUrl || '';
		q('dl-upd-manifest').value = settings.updates?.assetManifestUrl || '';
		q('dl-diag-debug').checked = Boolean(settings.debugLogging);
	};

	const renderUpdatesControls = () => {
		const slot = q('dl-updates-slot');
		if (!slot || slot.childElementCount > 0) {
			return;
		}
		slot.innerHTML = `
			<div class="dl-alert dl-alert-info" id="dl-upd-status-box">Patch &amp; app update status: Ready</div>
			<div class="dl-row">
				<button class="dl-btn" id="dl-upd-patch-apply" type="button">Check &amp; Apply Asset Patches</button>
				<button class="dl-btn dl-btn-danger" id="dl-upd-patch-cancel" type="button">Cancel Patch</button>
			</div>
			<div class="dl-row">
				<button class="dl-btn" id="dl-upd-app-check" type="button">Check App Update</button>
				<button class="dl-btn" id="dl-upd-app-download" type="button" disabled>Download App Update</button>
				<button class="dl-btn" id="dl-upd-app-install" type="button" disabled>Restart &amp; Install</button>
			</div>
		`;

		const statusBox = q('dl-upd-status-box');
		const refreshStatus = async () => {
			if (!window.electronAPI?.updates?.getStatus) {
				return;
			}
			const st = await window.electronAPI.updates.getStatus();
			const gen = st?.patch?.generation || 0;
			const appVer = st?.app?.downloadedVersion || st?.app?.availableVersion || null;
			statusBox.textContent = `Patch generation: #${gen} | Managed files: ${st?.patch?.fileCount || 0} | App: v${st?.app?.currentVersion || '0.0.0'}${appVer ? ` -> v${appVer}` : ''}`;
			q('dl-upd-app-download').disabled = !st?.app?.availableVersion;
			q('dl-upd-app-install').disabled = !st?.app?.downloadedInstallerPath;
		};

		q('dl-upd-patch-apply').addEventListener('click', async () => {
			setStatusMessage('Checking & applying signed asset patches...');
			q('dl-upd-save').click();
			const res = await window.electronAPI.updates.applyAssetPatch();
			if (!res?.ok) {
				statusBox.textContent = `Patch error: ${res?.code || 'FAILED'}`;
				setStatusMessage(`Asset patch failed (${res?.code || 'FAILED'}).`, true);
				return;
			}
			if (res.assetsStatus) {
				assetsStatus = res.assetsStatus;
			}
			renderAll();
			await refreshStatus();
			statusBox.textContent = res.upToDate
				? `Assets up to date at generation #${res.generation}.`
				: `Patched generation #${res.generation} (${res.downloadedCount} file(s) updated).`;
			setStatusMessage('Asset patch operation complete.');
		});

		q('dl-upd-patch-cancel').addEventListener('click', async () => {
			await window.electronAPI.updates.cancelAssetPatch();
			setStatusMessage('Asset patch canceled.');
		});

		q('dl-upd-app-check').addEventListener('click', async () => {
			q('dl-upd-save').click();
			const res = await window.electronAPI.updates.checkApp();
			if (!res?.ok) {
				statusBox.textContent = `Update check error: ${res?.code || 'FAILED'}`;
				setStatusMessage(`App update check failed (${res?.code || 'FAILED'}).`, true);
				return;
			}
			if (!res.updateAvailable) {
				statusBox.textContent = `App is up to date (v${res.currentVersion}).`;
			} else {
				statusBox.textContent = `App update available: v${res.update.version}`;
				q('dl-upd-app-download').disabled = false;
			}
		});

		q('dl-upd-app-download').addEventListener('click', async () => {
			const res = await window.electronAPI.updates.downloadApp();
			if (!res?.ok) {
				statusBox.textContent = `Download error: ${res?.code || 'FAILED'}`;
				return;
			}
			statusBox.textContent = `Verified installer v${res.version} ready to install.`;
			q('dl-upd-app-install').disabled = false;
		});

		q('dl-upd-app-install').addEventListener('click', async () => {
			const res = await window.electronAPI.updates.installApp();
			if (!res?.ok) {
				statusBox.textContent = `Install blocked/failed: ${res?.code || 'FAILED'}`;
			}
		});

		refreshStatus().catch(() => {});
	};

	const renderAll = () => {
		renderHeaderBadges();
		renderAssetsSection();
		renderServerList();
		renderPreferencesSection();
		renderUpdatesAndDiagnostics();
	};

	// Tabs switching
	for (const tabBtn of container.querySelectorAll('.dl-tab')) {
		tabBtn.addEventListener('click', () => {
			const targetTab = tabBtn.dataset.tab;
			for (const btn of container.querySelectorAll('.dl-tab')) {
				btn.setAttribute('aria-selected', btn === tabBtn ? 'true' : 'false');
			}
			for (const panel of container.querySelectorAll('.dl-panel')) {
				panel.classList.toggle('is-active', panel.dataset.panel === targetTab);
			}
		});
	}

	// Progress subscription
	const unsubscribeProgress = window.electronAPI.assets.onProgress(progress => {
		const wrap = q('dl-assets-progress-wrap');
		const fill = q('dl-assets-progress-fill');
		const text = q('dl-assets-progress-text');
		wrap.classList.remove('dl-hidden');
		const pct = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
		fill.style.width = `${pct}%`;
		text.textContent = `${progress?.message || progress?.stage || 'Indexing...'} (${pct}%)`;
		if (progress?.stage === 'ready' || pct >= 100) {
			setTimeout(() => wrap.classList.add('dl-hidden'), 600);
		}
	});

	// Assets actions
	q('dl-assets-select').addEventListener('click', async () => {
		setStatusMessage('Selecting client folder...');
		const res = await window.electronAPI.assets.selectDirectory();
		if (res?.canceled) {
			setStatusMessage('Folder selection canceled.');
			return;
		}
		if (!res?.ok) {
			setStatusMessage(`Asset initialization failed: ${res?.error || 'unknown error'}`, true);
			return;
		}
		assetsStatus = res.status;
		settings = await window.electronAPI.settings.load();
		renderAll();
		setStatusMessage('Local assets indexed successfully.');
	});

	q('dl-assets-reindex').addEventListener('click', async () => {
		if (!settings.assets?.directory && !assetsStatus?.rootDir) {
			setStatusMessage('Select a client directory first.', true);
			return;
		}
		setStatusMessage('Reindexing local assets...');
		assetsStatus = await window.electronAPI.assets.reindex();
		renderAll();
		setStatusMessage('Reindex completed.');
	});

	q('dl-assets-clear').addEventListener('click', async () => {
		setStatusMessage('Clearing asset index cache...');
		assetsStatus = await window.electronAPI.assets.clearCache();
		renderAll();
		setStatusMessage('Cache rebuilt.');
	});

	// Server CRUD
	q('dl-srv-save').addEventListener('click', async () => {
		const errBox = q('dl-srv-error');
		errBox.classList.add('dl-hidden');

		const address = q('dl-srv-address').value.trim();
		const port = Number.parseInt(q('dl-srv-port').value, 10);
		if (!address || /[\s\0]/.test(address)) {
			errBox.textContent = 'Enter a valid server host or IP address without spaces.';
			errBox.classList.remove('dl-hidden');
			return;
		}
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			errBox.textContent = 'Login port must be between 1 and 65535.';
			errBox.classList.remove('dl-hidden');
			return;
		}

		const candidate = {
			id: editingServerId || `srv-${Date.now()}`,
			display: q('dl-srv-display').value.trim() || `${address}:${port}`,
			address,
			port,
			packetver: q('dl-srv-packetver').value.trim() || 'executable',
			version: Number.parseInt(q('dl-srv-version').value, 10) || 55,
			langtype: Number.parseInt(q('dl-srv-langtype').value, 10) || 1,
			webserverAddress: q('dl-srv-webserver').value.trim(),
			remoteClient: q('dl-srv-remote-client').value.trim(),
			renewal: q('dl-srv-renewal').checked,
			forceUseAddress: q('dl-srv-force-address').checked
		};

		const existingIdx = settings.servers.findIndex(s => s.id === candidate.id);
		const nextServers = settings.servers.slice();
		if (existingIdx >= 0) {
			nextServers[existingIdx] = candidate;
		} else {
			nextServers.push(candidate);
		}

		settings = await window.electronAPI.settings.save({
			servers: nextServers,
			activeServerId: candidate.id
		});
		clearServerForm();
		renderAll();
		setStatusMessage(`Saved server "${candidate.display}".`);
	});

	q('dl-srv-clear').addEventListener('click', clearServerForm);

	// Preferences autosave
	const savePreferencesFromInputs = async () => {
		const nextPrefs = {
			screensize: q('dl-pref-screensize').value,
			fullscreen: q('dl-pref-fullscreen').checked,
			quality: Number.parseInt(q('dl-pref-quality').value, 10),
			fpslimit: Number.parseInt(q('dl-pref-fpslimit').value, 10),
			showCursor: q('dl-pref-cursor').checked,
			bgmEnabled: q('dl-pref-bgm-enabled').checked,
			bgmVolume: Number.parseInt(q('dl-pref-bgm-vol').value, 10) / 100,
			soundEnabled: q('dl-pref-sfx-enabled').checked,
			soundVolume: Number.parseInt(q('dl-pref-sfx-vol').value, 10) / 100
		};
		const nextLauncher = {
			skipIntroWhenReady: q('dl-pref-skip-intro').checked,
			autoLaunch: q('dl-pref-auto-launch').checked
		};
		settings = await window.electronAPI.settings.save({
			preferences: nextPrefs,
			launcher: nextLauncher
		});
		renderPreferencesSection();
	};

	q('dl-pref-quality').addEventListener('input', () => {
		q('dl-pref-quality-val').textContent = q('dl-pref-quality').value;
	});
	q('dl-pref-bgm-vol').addEventListener('input', () => {
		q('dl-pref-bgm-val').textContent = q('dl-pref-bgm-vol').value;
	});
	q('dl-pref-sfx-vol').addEventListener('input', () => {
		q('dl-pref-sfx-val').textContent = q('dl-pref-sfx-vol').value;
	});

	for (const id of [
		'dl-pref-screensize',
		'dl-pref-fullscreen',
		'dl-pref-quality',
		'dl-pref-fpslimit',
		'dl-pref-cursor',
		'dl-pref-bgm-enabled',
		'dl-pref-bgm-vol',
		'dl-pref-sfx-enabled',
		'dl-pref-sfx-vol',
		'dl-pref-skip-intro',
		'dl-pref-auto-launch'
	]) {
		q(id).addEventListener('change', savePreferencesFromInputs);
	}

	q('dl-pref-apply-window').addEventListener('click', async () => {
		await savePreferencesFromInputs();
		const prefs = settings.preferences;
		if (prefs.fullscreen || prefs.screensize === 'full') {
			await window.electronAPI.windowControls.setFullscreen(true);
		} else {
			const [w, h] = String(prefs.screensize || '1024x768').split('x');
			await window.electronAPI.windowControls.setSize(Number(w), Number(h));
		}
		setStatusMessage('Applied window resolution/fullscreen.');
	});

	// Updates & diagnostics
	q('dl-upd-save').addEventListener('click', async () => {
		settings = await window.electronAPI.settings.save({
			updates: {
				channel: q('dl-upd-channel').value,
				appFeedUrl: q('dl-upd-app-feed').value.trim(),
				assetManifestUrl: q('dl-upd-manifest').value.trim()
			}
		});
		renderUpdatesAndDiagnostics();
		setStatusMessage('Update settings saved.');
	});

	q('dl-diag-debug').addEventListener('change', async () => {
		settings = await window.electronAPI.settings.save({
			debugLogging: q('dl-diag-debug').checked
		});
		setStatusMessage(settings.debugLogging ? 'Debug file logging enabled.' : 'Debug file logging disabled.');
	});

	q('dl-diag-preview-btn').addEventListener('click', async () => {
		const snapshot = await window.electronAPI.diagnostics.getSnapshot();
		const pre = q('dl-diag-preview');
		pre.textContent = JSON.stringify(snapshot, null, 2);
		pre.classList.remove('dl-hidden');
	});

	q('dl-diag-export-btn').addEventListener('click', async () => {
		const res = await window.electronAPI.diagnostics.exportReport();
		if (res?.canceled) {
			setStatusMessage('Diagnostics export canceled.');
			return;
		}
		setStatusMessage(`Exported diagnostics to ${res.filePath}`);
	});

	q('dl-reset-btn').addEventListener('click', async () => {
		const btn = q('dl-reset-btn');
		if (!resetArmed) {
			resetArmed = true;
			btn.textContent = 'Confirm Reset?';
			clearTimeout(resetTimer);
			resetTimer = setTimeout(() => {
				resetArmed = false;
				btn.textContent = 'Reset Defaults';
			}, 4000);
			return;
		}
		clearTimeout(resetTimer);
		resetArmed = false;
		btn.textContent = 'Reset Defaults';
		settings = await window.electronAPI.settings.reset();
		clearServerForm();
		renderAll();
		setStatusMessage('Settings reset to defaults.');
	});

	q('launcher-play').addEventListener('click', async () => {
		q('launcher-play').disabled = true;
		setStatusMessage('Starting roBrowser engine...');
		try {
			await onLaunch({
				settings,
				assetsStatus,
				unmount: () => {
					unsubscribeProgress();
					container.remove();
				}
			});
		} catch (err) {
			q('launcher-play').disabled = false;
			setStatusMessage(`Launch failed: ${err?.message || 'unknown error'}`, true);
		}
	});

	renderUpdatesControls();
	renderAll();

	return {
		container,
		updatesSlot: q('dl-updates-slot'),
		getState: () => ({ settings, assetsStatus }),
		setStatusMessage,
		unmount: () => {
			unsubscribeProgress();
			container.remove();
		}
	};
}
