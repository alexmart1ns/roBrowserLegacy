/**
 * Core/Context.js
 *
 * Application Context
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */

let _electronFullscreen = false;

class Context {
	/**
	 * Get Informations about current Context
	 */
	static Is = {
		POPUP: !!window.opener,
		FRAME: window.top !== window.self
	};

	/**
	 * Check if roBrowser is in FullScreen
	 * @returns {boolean} is in fullscreen
	 */
	static isFullScreen() {
		return !!(
			document.fullscreenElement ||
			document.mozFullScreenElement ||
			document.webkitFullscreenElement ||
			_electronFullscreen
		);
	}

	/**
	 * Try to launch roBrowser in Full Screen
	 */
	static requestFullScreen() {
		if (window.electronAPI?.windowControls?.setFullscreen) {
			_electronFullscreen = true;
			window.electronAPI.windowControls.setFullscreen(true).catch(() => {});
			return;
		}
		if (!Context.isFullScreen()) {
			const element = document.documentElement;

			if (element.requestFullscreen) {
				element.requestFullscreen();
			} else if (element.mozRequestFullScreen) {
				element.mozRequestFullScreen();
			} else if (element.webkitRequestFullscreen) {
				element.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
			}
		}
	}

	/**
	 * Try to cancel roBrowser full screen
	 */
	static cancelFullScreen() {
		if (window.electronAPI?.windowControls?.setFullscreen) {
			_electronFullscreen = false;
			window.electronAPI.windowControls.setFullscreen(false).catch(() => {});
			return;
		}
		if (document.cancelFullScreen) {
			document.cancelFullScreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitCancelFullScreen) {
			document.webkitCancelFullScreen();
		}
	}

	/**
	 * Resize desktop or popup window safely
	 * @param {number|string} width
	 * @param {number|string} height
	 */
	static resizeWindow(width, height) {
		const w = Number.parseInt(String(width), 10);
		const h = Number.parseInt(String(height), 10);
		if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
			return;
		}

		if (window.electronAPI?.windowControls?.setSize) {
			_electronFullscreen = false;
			window.electronAPI.windowControls.setSize(w, h).catch(() => {});
			return;
		}

		if (Context.Is.POPUP) {
			if (w != window.innerWidth && h != window.innerHeight) {
				window.resizeTo(w, h);
				window.moveTo((screen.availWidth - w) / 2, (screen.availHeight - h) / 2);
			}
		}
	}

	/**
	 * Check list of API the web browser have to support to
	 * be able to execute roBrowser without problem.
	 *
	 * (2D graphics, 3D graphics, Threads, File API, ...)
	 */
	static checkSupport() {
		let gl, i;

		// Drag drop
		const div = document.createElement('div');
		if (!('draggable' in div) && !('ondragstart' in div && 'ondrop' in div)) {
			throw "Your web browser need to be updated, it does not support Drag 'nd Drop features.";
		}

		// Canvas
		const canvas = document.createElement('canvas');
		if (!canvas.getContext || !canvas.getContext('2d')) {
			throw 'Your web browser need to be updated, it does not support &lt;canvas&gt; element.';
		}

		// WebGL
		if (!window.WebGL2RenderingContext) {
			throw 'Your web browser need to be updated, it does not support WebGL2 3D graphics.';
		}

		const element = document.createElement('canvas');
		const contextNames = ['webgl2', 'experimental-webgl2'];

		for (i = 0; i < contextNames.length; ++i) {
			try {
				gl = element.getContext(contextNames[i], { powerPreference: 'high-performance' });
			} catch (e) {
				console.error(e);
			}

			if (gl) {
				break;
			}
		}

		if (!gl) {
			throw 'Your web browser OR your Graphics Card OR Drivers need to be updated, it does not support WebGL2 3D graphics.\nFor more informations check <a href="http://get.webgl.org/" target="_blank">get.webgl.org</a>';
		}

		// Web Worker
		if (!window.Worker) {
			throw 'Your web browser need to be updated, it does not support Threads (Web Worker API).';
		}

		// FileReader API
		if (!window.File || !window.FileList || !window.FileReader) {
			throw 'Your web browser need to be updated, it does not support File API.';
		}

		// DataView
		if (!window.DataView || !DataView.prototype.getFloat64) {
			throw 'Your web browser need to be updated, it does not support File API (DataView).';
		}
	}
}
/**
 * Export
 */
export default Context;
