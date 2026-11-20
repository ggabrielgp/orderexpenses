import { Children, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { flushSync } from "react-dom";

const AUTOPLAY_DELAY = 2000;
const TRANSITION_DURATION = 1200;

/** Recycle keyed screens around the center without cloning forms or their accessible IDs. */
export function LandingTourSlider({ labels, children }: { labels: readonly string[]; children: ReactNode }) {
	const trackRef = useRef<HTMLDivElement>(null);
	const trackId = useId();
	const [activeIndex, setActiveIndex] = useState(0);
	const activeRef = useRef(activeIndex);
	activeRef.current = activeIndex;
	const dragRef = useRef<{ pointerId: number; startX: number; lastX: number; recycled: boolean } | null>(null);
	const pendingOffsetRef = useRef(0);
	const animationRef = useRef<number | null>(null);
	const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const count = labels.length;
	const middle = Math.floor(count / 2);
	const mod = useCallback((index: number) => ((index % count) + count) % count, [count]);
	const screens = Children.toArray(children);
	const ordered = screens.map((_, position) => screens[mod(activeIndex + position - middle)]);

	const cancelAnimation = useCallback(() => {
		if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
		animationRef.current = null;
		if (trackRef.current) trackRef.current.style.scrollSnapType = dragRef.current ? "none" : "";
	}, []);
	const settle = useCallback(() => {
		const track = trackRef.current;
		if (!track || animationRef.current !== null || dragRef.current !== null) return;
		const center = track.scrollLeft + track.clientWidth / 2;
		const slides = [...track.querySelectorAll<HTMLElement>(".tour-item")];
		let nearest = middle;
		let distance = Infinity;
		for (const [index, slide] of slides.entries()) {
			const nextDistance = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - center);
			if (nextDistance < distance) { nearest = index; distance = nextDistance; }
		}
		setActiveIndex(mod(activeRef.current + nearest - middle));
	}, [middle, mod]);
	const recycleAt = (left: number) => {
		const track = trackRef.current;
		const slides = track?.querySelectorAll<HTMLElement>(".tour-item");
		if (!track || !slides?.[middle + 1]) return;
		const centerLeft = slides[middle].offsetLeft - (track.clientWidth - slides[middle].offsetWidth) / 2;
		const stride = slides[middle + 1].offsetLeft - slides[middle].offsetLeft;
		const offset = left - centerLeft;
		const shift = Math.round(offset / stride);
		if (shift !== 0) {
			const residual = offset - shift * stride;
			pendingOffsetRef.current = residual;
			if (dragRef.current) dragRef.current.recycled = true;
			// Rebase before the physical edge is reached, preserving movement under the held pointer.
			flushSync(() => setActiveIndex(mod(activeRef.current + shift)));
			pendingOffsetRef.current = 0;
			track.scrollTo({ left: centerLeft + residual, behavior: "instant" });
		} else track.scrollTo({ left, behavior: "instant" });
	};
	const onScroll = () => {
		const track = trackRef.current;
		if (track && animationRef.current === null && dragRef.current !== null) recycleAt(track.scrollLeft);
		if (settleRef.current !== null) clearTimeout(settleRef.current);
		if (animationRef.current === null && dragRef.current === null) settleRef.current = setTimeout(settle, 180);
	};

	// Reordering preserves the visible screens; recenter before paint so a wrap never leaves a blank half.
	useLayoutEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		const recenter = () => {
			cancelAnimation();
			const slide = track.querySelectorAll<HTMLElement>(".tour-item")[middle];
			if (slide) track.scrollTo({ left: slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2 + pendingOffsetRef.current, behavior: "instant" });
			pendingOffsetRef.current = 0;
		};
		recenter();
	}, [activeIndex, middle, cancelAnimation]);
	useEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		const observer = new ResizeObserver(() => {
			if (dragRef.current) return;
			cancelAnimation();
			const slide = track.querySelectorAll<HTMLElement>(".tour-item")[middle];
			if (slide) track.scrollTo({ left: slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2, behavior: "instant" });
		});
		observer.observe(track);
		return () => observer.disconnect();
	}, [middle, cancelAnimation]);

	const goTo = useCallback((index: number, automatic = false) => {
		const track = trackRef.current;
		const delta = mod(index - activeRef.current + middle) - middle;
		const slide = track?.querySelectorAll<HTMLElement>(".tour-item")[middle + delta];
		if (!track || !slide) return;
		cancelAnimation();
		const left = slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;
		if (!automatic || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			track.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
			return;
		}
		const start = performance.now();
		const from = track.scrollLeft;
		track.style.scrollSnapType = "none";
		const animate = (now: number) => {
			const progress = Math.min(1, (now - start) / TRANSITION_DURATION);
			const eased = .5 - Math.cos(Math.PI * progress) / 2;
			track.scrollTo({ left: from + (left - from) * eased, behavior: "instant" });
			if (progress < 1) animationRef.current = requestAnimationFrame(animate);
			else { animationRef.current = null; track.style.scrollSnapType = ""; settle(); }
		};
		animationRef.current = requestAnimationFrame(animate);
	}, [middle, mod, cancelAnimation, settle]);

	useEffect(() => {
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const updateMotion = () => { if (preference.matches) { cancelAnimation(); settle(); } };
		updateMotion();
		preference.addEventListener("change", updateMotion);
		return () => {
			preference.removeEventListener("change", updateMotion);
			cancelAnimation();
			if (settleRef.current !== null) clearTimeout(settleRef.current);
		};
	}, [cancelAnimation, settle]);
	useEffect(() => {
		// Fixed cadence: hover and keyboard focus do not pause playback. Let active gestures finish.
		const timer = setInterval(() => {
			if (dragRef.current === null) goTo(activeRef.current + 1, true);
		}, AUTOPLAY_DELAY);
		return () => clearInterval(timer);
	}, [goTo]);

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
		cancelAnimation();
		const track = event.currentTarget;
		dragRef.current = { pointerId: event.pointerId, startX: event.clientX, lastX: event.clientX, recycled: false };
		if (event.pointerType === "mouse") event.preventDefault();
		track.setPointerCapture(event.pointerId);
		track.dataset.dragging = "";
		track.style.scrollSnapType = "none";
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const movement = drag.lastX - event.clientX;
		drag.lastX = event.clientX;
		recycleAt(event.currentTarget.scrollLeft + movement);
	};
	const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		dragRef.current = null;
		const track = event.currentTarget;
		delete track.dataset.dragging;
		track.style.scrollSnapType = "";
		if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
		const distance = drag.lastX - drag.startX;
		goTo(activeRef.current + (drag.recycled || Math.abs(distance) < 40 ? 0 : distance < 0 ? 1 : -1));
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return;
		const targets: Record<string, number> = { ArrowLeft: activeIndex - 1, ArrowRight: activeIndex + 1, Home: 0, End: count - 1 };
		if (!(event.key in targets)) return;
		event.preventDefault(); goTo(targets[event.key]);
	};
	return <div className="landing-tour-slider">
		<div className="tour-track" id={trackId} role="region" aria-label="Pantallas de la app"
			tabIndex={0} ref={trackRef} onScroll={onScroll} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd}>
			<ul className="landing-tour-list">{ordered}</ul>
		</div>
		<nav className="landing-tour-controls" aria-label="Controles del recorrido">
			<button className="landing-tour-arrow" type="button" aria-label="Pantalla anterior" aria-controls={trackId}
				onClick={() => goTo(activeIndex - 1)}><span aria-hidden="true">‹</span></button>
			<div className="landing-tour-dots">
				{labels.map((label, index) => <button className="landing-tour-dot" type="button" key={label}
					aria-label={`Ver ${label}, ${index + 1} de ${count}`} aria-controls={trackId}
					aria-current={activeIndex === index ? "true" : undefined} onClick={() => goTo(index)} />)}
			</div>
			<button className="landing-tour-arrow" type="button" aria-label="Pantalla siguiente" aria-controls={trackId}
				onClick={() => goTo(activeIndex + 1)}><span aria-hidden="true">›</span></button>
		</nav>
		<p className="landing-tour-position" aria-live="off" aria-atomic="true">Pantalla {activeIndex + 1} de {count}: {labels[activeIndex]}</p>
	</div>;
}
