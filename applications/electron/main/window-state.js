/**
 * Display-safe window bounds calculation and clamping.
 * Ensures restored window positions remain visible on connected displays.
 */

export function clampWindowBoundsToDisplays(savedBounds, displays, primaryDisplay) {
	const width = Math.max(800, Number.isInteger(savedBounds?.width) ? savedBounds.width : 1024);
	const height = Math.max(600, Number.isInteger(savedBounds?.height) ? savedBounds.height : 768);
	const maximized = Boolean(savedBounds?.maximized);

	const fallbackArea = primaryDisplay?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };
	const clampedWidth = Math.min(width, Math.max(800, fallbackArea.width));
	const clampedHeight = Math.min(height, Math.max(600, fallbackArea.height));

	const hasSavedPosition = Number.isInteger(savedBounds?.x) && Number.isInteger(savedBounds?.y);
	if (hasSavedPosition && Array.isArray(displays) && displays.length > 0) {
		const rect = {
			x: savedBounds.x,
			y: savedBounds.y,
			width: clampedWidth,
			height: clampedHeight
		};

		const isVisibleOnAnyDisplay = displays.some(display => {
			const wa = display?.workArea;
			if (!wa) {
				return false;
			}
			const overlapX = Math.max(0, Math.min(rect.x + rect.width, wa.x + wa.width) - Math.max(rect.x, wa.x));
			const overlapY = Math.max(0, Math.min(rect.y + rect.height, wa.y + wa.height) - Math.max(rect.y, wa.y));
			return overlapX >= 100 && overlapY >= 60;
		});

		if (isVisibleOnAnyDisplay) {
			return {
				x: rect.x,
				y: rect.y,
				width: clampedWidth,
				height: clampedHeight,
				maximized
			};
		}
	}

	// Center on primary display work area if no saved coordinates or display disconnected
	return {
		x: Math.round(fallbackArea.x + Math.max(0, (fallbackArea.width - clampedWidth) / 2)),
		y: Math.round(fallbackArea.y + Math.max(0, (fallbackArea.height - clampedHeight) / 2)),
		width: clampedWidth,
		height: clampedHeight,
		maximized
	};
}
