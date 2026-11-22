import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildDemoPreviewPath, type DemoPreviewFocus, type DemoPreviewView } from "../demo/demoPreview";
import type { DemoScenario } from "../demo/demoScenarios";
import "./landing-phone-live.css";

/** The real app is laid out for a phone this wide; the landing shows exactly that layout, scaled down. */
const SCREEN_WIDTH = 390;
/** A lazy phone starts loading when its section is this close to the viewport. */
const LOAD_MARGIN = "600px 0px";

export interface LandingPhoneScreenProps {
	view: DemoPreviewView;
	scenario?: DemoScenario;
	focus?: DemoPreviewFocus;
	/** Accessible name of the iframe. */
	title: string;
	/** Text alternative for the screen, read by assistive technology (the iframe itself is hidden from it). */
	description: string;
	/** Only the first phone on the page loads at once; every other one waits until its section is near the viewport. */
	eager?: boolean;
}

/**
 * A phone screen that is the real read-only demo (`/app/demo?preview=…`, S25) at 390px, scaled to the frame.
 *
 * The iframe is decoration for sighted users: not focusable (`tabindex=-1`, inert wrapper), not
 * clickable (`pointer-events: none`) and hidden from assistive technology, which reads the text
 * alternative instead. Its box is reserved by the frame, so loading never shifts the page.
 *
 * Lazy phones do not rely on the browser's native `loading="lazy"` alone: its distance threshold is
 * large (up to 2500px) and measured per element, so on a desktop the whole tour would load with the
 * hero. The `src` is set when the surrounding section nears the viewport; `data-src` always names it.
 */
export function LandingPhoneScreen({ view, scenario, focus, title, description, eager = false }: LandingPhoneScreenProps) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [near, setNear] = useState(eager);
	const path = buildDemoPreviewPath({ view, scenario, focus });

	useEffect(() => {
		const viewport = viewportRef.current;
		if (near || !viewport) return;
		if (!("IntersectionObserver" in window)) { setNear(true); return; }
		// The section, not the phone: tour slides sit inside a horizontal scroller that clips them.
		const observer = new IntersectionObserver(([entry]) => {
			if (entry?.isIntersecting) { setNear(true); observer.disconnect(); }
		}, { rootMargin: LOAD_MARGIN });
		observer.observe(viewport.closest("section") ?? viewport);
		return () => observer.disconnect();
	}, [near]);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const fit = () => {
			// Layout size, not the painted one: the tour scales and the hero tilts the whole phone.
			if (viewport.clientWidth === 0) return;
			const scale = viewport.clientWidth / SCREEN_WIDTH;
			viewport.style.setProperty("--live-scale", String(scale));
			viewport.style.setProperty("--live-height", `${viewport.clientHeight / scale}px`);
		};
		const observer = new ResizeObserver(fit);
		observer.observe(viewport);
		fit();
		return () => observer.disconnect();
	}, []);

	return <div className="landing-phone-live">
		<p className="landing-phone-live-alt">{description}</p>
		<div className="landing-phone-live-viewport" ref={viewportRef} inert>
			<iframe
				src={near ? path : undefined}
				data-src={path}
				title={title}
				loading={eager ? "eager" : "lazy"}
				tabIndex={-1}
				aria-hidden="true"
				width={SCREEN_WIDTH}
				height={748}
				sandbox="allow-scripts allow-same-origin"
			/>
		</div>
	</div>;
}
