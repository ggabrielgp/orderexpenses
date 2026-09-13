import { useEffect, useRef, useState, type ReactNode } from "react";

interface RevealOnScrollProps {
	children: ReactNode;
	className?: string;
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

/** A small CSS-motion wrapper that reveals content once it enters the viewport. */
export function RevealOnScroll({ children, className = "" }: RevealOnScrollProps) {
	const elementRef = useRef<HTMLDivElement>(null);
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		const mediaQuery = window.matchMedia(reducedMotionQuery);
		if (mediaQuery.matches || !("IntersectionObserver" in window)) {
			setIsVisible(true);
			return;
		}

		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting) return;
				setIsVisible(true);
				observer.disconnect();
			},
			{ threshold: 0.15 },
		);
		const element = elementRef.current;
		if (element) observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return (
		<div ref={elementRef} className={`landing-reveal ${isVisible ? "is-visible" : ""} ${className}`}>
			{children}
		</div>
	);
}
