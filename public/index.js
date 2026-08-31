const action = typeof document === "undefined" ? null : document.querySelector("#landingSessionAction");
const identity = typeof document === "undefined" ? null : document.querySelector("#landingSessionIdentity");

export function renderLandingSession(action, identity, session) {
	if (!session?.authenticated || !session.profile) return;
	action.href = "/app";
	action.setAttribute("aria-label", "Ir al dashboard");
	action.querySelector("span:last-child").textContent = "Ir al dashboard";
	identity.textContent = session.profile.name || session.profile.email;
	identity.hidden = false;
}

async function loadLandingSession() {
	try {
		const response = await fetch("/api/session/profile");
		const session = response.ok ? await response.json() : null;
		renderLandingSession(action, identity, session);
	} catch {
		// The public landing remains usable when the optional profile endpoint is unavailable.
	}
}

if (action && identity) loadLandingSession();
