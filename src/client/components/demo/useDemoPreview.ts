import { useEffect } from "react";
import type { DemoPreview, DemoPreviewFocus } from "./demoPreview";
import "./demo-preview.css";

/** The real section each non-default focus starts on. */
const FOCUS_SELECTORS: Record<Exclude<DemoPreviewFocus, "top">, string> = {
	spending: ".react-spending-chart",
	categories: ".react-category-distribution",
};

/** Breathing room above the section, in CSS px of the 390px-wide page. */
const FOCUS_MARGIN = 12;

/**
 * Side effects of the preview mode, only while a preview is requested: hide this document's scrollbar,
 * and start at the top (or at the requested section). It scrolls with `window.scrollTo`, never
 * `scrollIntoView`, so only this iframe moves and not the landing around it, and it never focuses
 * anything. Layout can still settle after the first paint (charts mount), so the position is reapplied
 * a few times. Instant, so there is no scroll animation to respect or to disable.
 */
export function useDemoPreview(preview: DemoPreview | null): void {
	const view = preview?.view ?? null;
	const focus = preview?.focus ?? null;
	useEffect(() => {
		if (view === null || focus === null) return;
		const root = document.documentElement;
		root.classList.add("demo-preview");
		const place = () => {
			let top = 0;
			if (focus !== "top") {
				const target = document.querySelector<HTMLElement>(FOCUS_SELECTORS[focus]);
				const header = document.querySelector<HTMLElement>(".react-app-header");
				if (target) top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - (header?.offsetHeight ?? 0) - FOCUS_MARGIN);
			}
			window.scrollTo({ top, left: 0, behavior: "instant" });
		};
		place();
		const timers = focus === "top" ? [] : [250, 800].map((delay) => window.setTimeout(place, delay));
		return () => {
			timers.forEach((timer) => window.clearTimeout(timer));
			root.classList.remove("demo-preview");
		};
	}, [view, focus]);
}
