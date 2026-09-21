import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getSessionProfile } from "../api/client";
import type { SessionResponse } from "../api/types";
import { loadDemoDashboardData, type DemoDashboardData } from "../demo-data";
import { DashboardPage, DemoDashboardPage } from "../pages/DashboardPage";

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; session: SessionResponse };

/** Keeps the existing React dashboard data boundary out of route selection. */
export function DashboardRoute() {
	return isDemoDashboardRoute(window.location.pathname) ? <DemoDashboardRoute /> : <AccountDashboardRoute />;
}

export function isDemoDashboardRoute(pathname: string) {
	return pathname === "/app/demo" || pathname === "/app/demo/";
}

type DemoLoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; data: DemoDashboardData };

export function DemoDashboardRoute() {
	const [state, setState] = useState<DemoLoadState>({ status: "loading" });
	const [retryToken, setRetryToken] = useState(0);
	const retry = useCallback(() => setRetryToken((token) => token + 1), []);

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });
		loadDemoDashboardData(controller.signal)
			.then((data) => {
				if (!controller.signal.aborted) setState({ status: "ready", data });
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setState({ status: "error", message: "No se pudieron cargar los datos de ejemplo." });
				}
			});
		return () => controller.abort();
	}, [retryToken]);

	if (state.status === "loading") {
		return <ShellMessage title="Cargando demo" copy="Preparando datos sintéticos de ejemplo." />;
	}
	if (state.status === "error") {
		return (
			<ShellMessage title="Demo no disponible" copy={state.message}>
				<button type="button" onClick={retry}>Reintentar</button>
			</ShellMessage>
		);
	}
	return <DemoDashboardPage data={state.data} />;
}

function AccountDashboardRoute() {
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [retryToken, setRetryToken] = useState(0);
	const retry = useCallback(() => setRetryToken((token) => token + 1), []);

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });
		getSessionProfile(controller.signal)
			.then((session) => {
				if (!controller.signal.aborted) setState({ status: "ready", session });
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setState({
						status: "error",
						message: "No pudimos cargar tu sesión.",
					});
				}
			});

		return () => controller.abort();
	}, [retryToken]);

	if (state.status === "loading") {
		return <ShellMessage title="Cargando tu cuenta" copy="Verificando tu sesión..." />;
	}
	if (state.status === "error") {
		return (
			<ShellMessage title="No se pudo cargar la cuenta" copy={state.message}>
				<button type="button" onClick={retry}>Reintentar</button>
			</ShellMessage>
		);
	}
	return <DashboardPage session={state.session} onRetry={retry} />;
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
