type LandingViewport = Pick<Window,
	"innerHeight" | "addEventListener" | "removeEventListener" |
	"requestAnimationFrame" | "cancelAnimationFrame"
>;

/** Track native scrolling without intercepting anchor links or changing the URL. */
export function watchLandingSections(
	sections: readonly HTMLElement[],
	getOffset: () => number,
	onChange: (sectionId: string | null) => void,
	viewport: LandingViewport = window,
	navigation?: HTMLElement,
) {
	let frame: number | null = null;
	let pendingSection: string | null = null;

	function update() {
		frame = null;
		const offset = getOffset();
		const visible = sections.map((section) => ({
			id: section.id,
			bounds: section.getBoundingClientRect(),
		}));
		const current = visible.find(({ bounds }) => bounds.top <= offset && bounds.bottom > offset);
		const last = visible.at(-1);
		// A short final section may never reach the header at maximum scroll.
		const finalVisible = last && last.bounds.top >= offset && last.bounds.bottom <= viewport.innerHeight;
		const visibleSection = finalVisible ? last.id : current?.id ?? null;
		// A clicked link represents intent; do not highlight sections crossed en route.
		if (pendingSection === visibleSection) pendingSection = null;
		onChange(pendingSection ?? visibleSection);
	}

	function scheduleUpdate() {
		if (frame === null) frame = viewport.requestAnimationFrame(update);
	}

	function selectDestination(event: Event) {
		const click = event as MouseEvent;
		if (click.defaultPrevented || click.button !== 0 || click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return;
		const anchor = (event.target as Element | null)?.closest("a[href^='#']");
		const id = anchor?.getAttribute("href")?.slice(1);
		if (!id || !sections.some((section) => section.id === id)) return;
		pendingSection = id;
		onChange(id);
		scheduleUpdate();
	}

	function resumeManualTracking(event: Event) {
		if (event.type === "keydown" && ![
			"ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Escape",
		].includes((event as KeyboardEvent).key)) return;
		pendingSection = null;
		scheduleUpdate();
	}

	const manualEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
	update();
	viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
	viewport.addEventListener("resize", scheduleUpdate, { passive: true });
	for (const event of manualEvents) viewport.addEventListener(event, resumeManualTracking, { passive: true });
	navigation?.addEventListener("click", selectDestination, { passive: true });
	return () => {
		viewport.removeEventListener("scroll", scheduleUpdate);
		viewport.removeEventListener("resize", scheduleUpdate);
		for (const event of manualEvents) viewport.removeEventListener(event, resumeManualTracking);
		navigation?.removeEventListener("click", selectDestination);
		if (frame !== null) viewport.cancelAnimationFrame(frame);
	};
}
