import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getGmailStatus, getSessionProfile, syncGmail } from "../api/client";
import type { GmailStatusResponse, SessionResponse } from "../api/types";
import { DashboardPage } from "../pages/DashboardPage";

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; session: SessionResponse; gmail: GmailStatusResponse };

type GmailSyncState = "idle" | "syncing" | "error";

/** Keeps the existing React dashboard data boundary out of route selection. */
export function DashboardRoute() {
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [retryToken, setRetryToken] = useState(0);
	const [gmailSyncState, setGmailSyncState] = useState<GmailSyncState>("idle");
	const oauthSyncStarted = useRef(false);

	const retry = useCallback(() => setRetryToken((token) => token + 1), []);
	const synchronizeAfterOAuth = useCallback(async () => {
		setGmailSyncState("syncing");
		try {
			await syncGmail();
			setGmailSyncState("idle");
			retry();
		} catch {
			setGmailSyncState("error");
		}
	}, [retry]);

	useEffect(() => {
		const url = new URL(window.location.href);
		if (oauthSyncStarted.current || url.searchParams.get("gmail") !== "connected") return;

		oauthSyncStarted.current = true;
		url.searchParams.delete("gmail");
		window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
		void synchronizeAfterOAuth();
	}, [synchronizeAfterOAuth]);

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });

		Promise.all([getSessionProfile(controller.signal), getGmailStatus(controller.signal)])
			.then(([session, gmail]) => {
				if (!controller.signal.aborted) setState({ status: "ready", session, gmail });
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setState({
						status: "error",
						message: "We could not load your session or Gmail connection status.",
					});
				}
			});

		return () => controller.abort();
	}, [retryToken]);

	if (gmailSyncState === "syncing") {
		return <ShellMessage title="Synchronizing Gmail" copy="Gmail is connected. Importing your latest movements..." />;
	}
	if (gmailSyncState === "error") {
		return (
			<ShellMessage title="Unable to synchronize Gmail" copy="Your Gmail account is connected, but we could not import your movements.">
				<button type="button" onClick={synchronizeAfterOAuth}>Retry Gmail sync</button>
				<a className="button react-secondary-link" href="/legacy-app">Open legacy dashboard</a>
			</ShellMessage>
		);
	}
	if (state.status === "loading") {
		return <ShellMessage title="Loading your account" copy="Checking your session and Gmail connection..." />;
	}
	if (state.status === "error") {
		return (
			<ShellMessage title="Unable to load the account" copy={state.message}>
				<button type="button" onClick={retry}>Retry</button>
				<a className="button react-secondary-link" href="/legacy-app">Open legacy dashboard</a>
			</ShellMessage>
		);
	}
	return <DashboardPage session={state.session} gmail={state.gmail} onRetry={retry} />;
}

function ShellMessage({ title, copy, children }: { title: string; copy: string; children?: ReactNode }) {
	return (
		<main className="shell react-shell">
			<section className="panel product-panel react-message" aria-live="polite">
				<h1>{title}</h1>
				<p className="subtitle">{copy}</p>
				{children && <div className="react-shell-actions">{children}</div>}
			</section>
		</main>
	);
}
