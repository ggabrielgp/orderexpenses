import { useLayoutEffect, useRef, type ReactNode } from "react";
import { BrandMark } from "../brand/BrandMark";

/** Shared illustration chrome: the tour scales this same phone, rather than drawing another model. */
export function LandingPhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const body = bodyRef.current;
		const content = contentRef.current;
		if (!body || !content) return;
		let active = true;
		const fitContent = () => {
			if (!active) return;
			const style = getComputedStyle(body);
			const availableHeight = body.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
			// Measure untransformed layout: fitting the illustration must never enlarge the phone.
			const nextScale = content.scrollHeight > 0 ? Math.min(1, Math.max(0, availableHeight) / content.scrollHeight) : 1;
			// Apply in the measurement callback, not a deferred React render that can paint clipped content.
			content.style.transform = `scale(${nextScale})`;
		};
		const observer = new ResizeObserver(fitContent);
		observer.observe(body);
		observer.observe(content);
		fitContent();
		void document.fonts.ready.then(fitContent);
		return () => { active = false; observer.disconnect(); };
	}, []);

	return <div className={`landing-phone ${className}`.trim()}>
		<div className="landing-stage-window">
			<div className="landing-phone-island" aria-hidden="true" />
			<div className="landing-stage-topbar">
				<strong><BrandMark size={18} />Gastos Controlados</strong>
			</div>
			<div className="landing-stage-body" ref={bodyRef}>
				<div className="landing-phone-content" ref={contentRef} style={{ transform: "scale(1)" }}>{children}</div>
			</div>
			<div className="landing-phone-home" aria-hidden="true" />
		</div>
	</div>;
}
