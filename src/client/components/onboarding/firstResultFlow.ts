import { markFirstResultSeen, type FirstResultStorage } from "./firstResult";

/**
 * Decisions for onboarding step 3 ("Paso 3 de 3 · Tu medidor", S21), the dialog that follows the first
 * cycle save. No React and no DOM: the summary owns the state and the rendering, this owns the rules.
 *
 *   idle       nothing to show (the initial phase, and after any close)
 *   waiting    the first cycle was just saved; the summary has not started reloading yet
 *   preparing  the summary is reloading the new cycle; the dialog shows its loading state
 *   shown      the reload yielded the ready state; the dialog shows the real gauge
 */
export type FirstResultPhase = "idle" | "waiting" | "preparing" | "shown";

/** The summary states the flow observes. */
export type FirstResultSummaryStatus = "loading" | "failed" | "unconfigured" | "ready";

/** Only a first save that was not already seen opens step 3: never the demo, an edit or a repeat. */
export function startFirstResult(seen: boolean): FirstResultPhase {
	return seen ? "idle" : "waiting";
}

/** True while the dialog is on screen, whether loading or showing the gauge. */
export function isFirstResultOpen(phase: FirstResultPhase): boolean {
	return phase !== "idle";
}

/**
 * Advances the phase after the summary state changed. Observing never opens an idle flow. A reload that
 * fails (or leaves the cycle unconfigured) closes the step so the existing failed or setup state shows;
 * it does not mark the step as seen, because the user never saw the gauge.
 */
export function observeFirstResult(phase: FirstResultPhase, status: FirstResultSummaryStatus): FirstResultPhase {
	switch (phase) {
		case "waiting":
			// The saved state is still "unconfigured" until the reload starts, so that is not a failure yet.
			if (status === "loading") return "preparing";
			if (status === "ready") return "shown";
			if (status === "failed") return "idle";
			return "waiting";
		case "preparing":
			if (status === "ready") return "shown";
			if (status === "failed" || status === "unconfigured") return "idle";
			return "preparing";
		default:
			return phase;
	}
}

/**
 * The user closed the step ("Ver mi resumen", Escape or the backdrop). Only the shown step can be
 * dismissed — the loading state is brief and ends by itself — and dismissing it marks it seen.
 */
export function dismissFirstResult(phase: FirstResultPhase, storage: FirstResultStorage | null | undefined): FirstResultPhase {
	if (phase !== "shown") return phase;
	markFirstResultSeen(storage);
	return "idle";
}
