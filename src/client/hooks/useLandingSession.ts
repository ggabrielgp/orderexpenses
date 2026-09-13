import { useEffect, useState } from "react";
import { getSessionProfile } from "../api/client";
import type { SessionResponse } from "../api/types";

/** The marketing page stays usable if its optional session request fails. */
export function useLandingSession() {
	const [session, setSession] = useState<SessionResponse | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		getSessionProfile(controller.signal)
			.then((nextSession) => {
				if (!controller.signal.aborted) setSession(nextSession);
			})
			.catch(() => undefined);
		return () => controller.abort();
	}, []);

	return session;
}
