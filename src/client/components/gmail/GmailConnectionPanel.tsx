import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type SyntheticEvent,
} from "react";
import { disconnectGmail, getGmailStatus } from "../../api/client";
import {
	acquireInFlightLock,
	releaseInFlightLock,
	syncNativeModalDialog,
} from "../movements/CreateManualExpenseDialog";
import {
	applyGmailDisconnectOutcome,
	applyGmailStatusOutcome,
	canConfirmGmailDisconnect,
	canOfferGmailActions,
	canOfferGmailDisconnect,
	canRefreshGmailStatus,
	createGmailConnectionState,
	createGmailDisconnectState,
	createGmailDisconnectSubmitter,
	createGmailStatusRefresher,
	getGmailConnectionView,
	getGmailDisconnectConfirmation,
	getGmailDisconnectErrorMessage,
	getGmailDisconnectNotice,
	reduceGmailConnection,
	reduceGmailDisconnectDismissal,
	reduceGmailDisconnectState,
	reduceGmailStatusRefreshStart,
	startGmailStatusAttempt,
	startGmailStatusLoad,
	type GmailConnectionState,
	type GmailDisconnectNotice,
	type GmailDisconnectState,
	type GmailStatusRefreshOutcome,
} from "./gmailConnection";
import {
	GMAIL_SYNC_PENDING_MESSAGE,
	GMAIL_SYNC_UNAVAILABLE_MESSAGE,
	canOfferGmailSync,
	canStartGmailSync,
	createGmailSyncState,
	getGmailSyncErrorMessage,
	getGmailSyncNotice,
	reduceGmailSync,
	shouldSyncGmail,
	type GmailSyncState,
	type GmailSyncSubmitter,
} from "./gmailSync";

/** Connect control supplied by the dashboard; only rendered while no account is connected. */
export type GmailConnectControlSlot = (connected: boolean) => ReactNode;

export interface GmailConnectionCardProps {
	/** State the panel produced; the card never keeps a second copy of it. */
	state: GmailConnectionState;
	/** Outcome of a completed disconnection; `null` renders no notice. */
	notice: GmailDisconnectNotice | null;
	/**
	 * Manual sync request the dashboard built, or `null` while no configured period exists to sync.
	 *
	 * The card never builds it and never reaches the sync endpoint itself: the request always sends
	 * the configured period, and only the dashboard knows whether the cycle is configured.
	 */
	submitSync?: GmailSyncSubmitter | null;
	/**
	 * Session guard. It defaults to the safe answer — a card that was not told about a session
	 * offers no request that needs one.
	 */
	authenticated?: boolean;
	/** Manual sync lifecycle; defaults to `idle` for a card that was given none. */
	sync?: GmailSyncState;
	/** Runs the manual sync; the panel owns the lifecycle it reports. */
	onSync?: () => void;
	/**
	 * The dashboard's consent-gated connect control (unit A), handed the effective connection
	 * state. It is a slot so this card never builds, duplicates, or re-invents the consent flow —
	 * and so the control's refusal guard reads the real state instead of a stale session snapshot.
	 */
	connectControl: GmailConnectControlSlot;
	onRefreshStatus: () => void;
	onOpenDisconnect: () => void;
}

/**
 * Presentational card body. It renders exactly the state it is given, so every phase and notice is
 * renderable in the static markup harness this repository tests with, and so the manual sync
 * control sits next to the existing actions without any of them being restructured.
 */
export function GmailConnectionCard({
	state,
	notice,
	submitSync = null,
	authenticated = false,
	sync = createGmailSyncState(),
	onSync,
	connectControl,
	onRefreshStatus,
	onOpenDisconnect,
}: GmailConnectionCardProps) {
	const view = getGmailConnectionView(state);
	const isRefreshing = state.phase === "loading";
	const canRefresh = canRefreshGmailStatus(state);
	// While the server is not configured the card offers no control at all: neither the re-read nor
	// the connect entry can change that state, so neither may be presented as the way out.
	const canOfferActions = canOfferGmailActions(state);
	// The disconnection is offered only when the real state is known and no read is pending, so a
	// pre-disconnection answer can never be applied after a confirmed disconnection.
	const canDisconnect = canOfferGmailDisconnect(state);
	// The sync control is offered only to a session that may send it, for an account that exists,
	// with a request the dashboard actually published. Its own rule keeps the control visible but
	// locked while an attempt is in flight, so the in-flight state is what the user sees.
	const offersSync = canOfferGmailSync({
		authenticated,
		connected: view.connected,
		hasRequest: submitSync !== null,
	});
	const canStartSync = canStartGmailSync(sync);
	const isSyncing = sync.phase === "syncing";
	const syncNotice = getGmailSyncNotice(sync);
	/**
	 * A settled sync result describes the account that was read, so it is only shown while that
	 * account is still connected: after a disconnection Gmail-imported movements stop being
	 * readable, and a notice claiming the summary now shows them would no longer be true.
	 */
	const canReportSyncResult = canOfferActions && view.connected;

	return (
		<>
			<span className="section-kicker">Conexión con Gmail</span>
			<strong>{view.title}</strong>
			{view.activeEmail !== null && (
				<p className="react-gmail-connection-account">{view.activeEmail}</p>
			)}
			{/* The message is the only place the phase speaks: a read in progress and a failed read are
			    announced, while a known state is simply described. */}
			<p
				className={`react-gmail-connection-message react-gmail-connection-message-${state.phase}`}
				role={state.phase === "loading" ? "status" : state.phase === "failed" ? "alert" : undefined}
			>
				{view.message}
			</p>
			{notice !== null && (
				<p
					className={`react-gmail-connection-notice react-gmail-connection-notice-${notice.tone}`}
					role="status"
				>
					{notice.message}
				</p>
			)}
			{/* The in-flight state is indeterminate on purpose: the server reports no progress, so the
			    card says only that the sync is running and that no partial advance can be shown. */}
			{canOfferActions && isSyncing && (
				<p className="react-gmail-sync-pending" role="status">
					{GMAIL_SYNC_PENDING_MESSAGE}
				</p>
			)}
			{canOfferActions && syncNotice !== null && canReportSyncResult && (
				<p
					className={`react-gmail-sync-notice react-gmail-sync-notice-${syncNotice.tone}`}
					role={syncNotice.tone === "error" ? "alert" : "status"}
				>
					{syncNotice.message}
				</p>
			)}
			{canOfferActions && (
				<div className="react-gmail-connection-actions">
					{!view.connected && connectControl(view.connected)}
					{canDisconnect && (
						<button className="secondary" type="button" onClick={onOpenDisconnect}>
							Desconectar Gmail
						</button>
					)}
					<button
						className="secondary"
						type="button"
						onClick={onRefreshStatus}
						disabled={!canRefresh}
						aria-busy={isRefreshing}
					>
						{isRefreshing ? "Revisando estado de Gmail..." : "Actualizar estado de Gmail"}
					</button>
					{offersSync && (
						<button
							className="button react-gmail-sync-control"
							type="button"
							onClick={onSync}
							disabled={!canStartSync}
							aria-busy={isSyncing}
						>
							{isSyncing ? "Sincronizando con Gmail..." : "Sincronizar con Gmail"}
						</button>
					)}
				</div>
			)}
			{/* A connected account with no configured cycle gets the reason instead of a silent gap:
			    without a period there is no request this card could describe truthfully. */}
			{canOfferActions &&
				shouldSyncGmail(authenticated) &&
				view.connected &&
				submitSync === null && (
					<p className="react-gmail-sync-unavailable">{GMAIL_SYNC_UNAVAILABLE_MESSAGE}</p>
				)}
		</>
	);
}

export interface GmailDisconnectDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** State produced by `reduceGmailDisconnectState`; the dialog never keeps a second phase copy. */
	state: GmailDisconnectState;
	/**
	 * Dismiss intent. It never re-sends anything.
	 *
	 * The parent maps it by phase through `reduceGmailDisconnectDismissal`: a confirmation is called
	 * off and a settled result is closed, while a disconnection in flight is not dismissible.
	 */
	onCancel: () => void;
	/** Confirm intent. The parent performs the POST and feeds the outcome back as state. */
	onConfirm: () => void;
}

/**
 * Native confirmation modal for the disconnection. It is a real modal, using the same
 * `syncNativeModalDialog` helper as unit A's consent dialog and the movement dialogs: no
 * irreversible server mutation deserves less protection (focus trap, inert `::backdrop`).
 *
 * `Esc` is prevented while the POST is in flight: closing then would hide the outcome of a
 * request that may already have removed the stored authorization.
 */
export function GmailDisconnectDialog({
	isOpen,
	state,
	onCancel,
	onConfirm,
}: GmailDisconnectDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	if (!isOpen) return null;

	const confirmation = getGmailDisconnectConfirmation();
	const isDisconnecting = state.phase === "disconnecting";
	const isSettled = state.phase === "disconnected" || state.phase === "failed";
	const canConfirm = canConfirmGmailDisconnect(state);
	const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
		if (isDisconnecting) event.preventDefault();
	};

	return (
		<dialog
			ref={dialogRef}
			className="react-gmail-disconnect-dialog"
			aria-labelledby="react-gmail-disconnect-title"
			aria-describedby="react-gmail-disconnect-description"
			onCancel={handleDialogCancel}
			onClose={onCancel}
		>
			<h2 id="react-gmail-disconnect-title">{confirmation.title}</h2>
			<div id="react-gmail-disconnect-description" className="react-gmail-disconnect-statements">
				{confirmation.statements.map((statement, index) => (
					<p key={index}>{statement}</p>
				))}
			</div>
			{isDisconnecting && (
				<p className="react-gmail-disconnect-pending" role="status">
					Desconectando Gmail...
				</p>
			)}
			{state.phase === "failed" && state.errorMessage !== null && (
				<p className="react-gmail-disconnect-error" role="alert">
					{state.errorMessage}
				</p>
			)}
			{state.phase === "disconnected" && (
				<div className="react-gmail-disconnect-result" role="status">
					<p>Gmail se desconectó correctamente.</p>
					{state.statusRefreshFailed && (
						<p className="react-gmail-disconnect-stale">
							El estado de la conexión no se pudo actualizar y puede estar desactualizado.
							Actualiza la página para ver el estado real.
						</p>
					)}
				</div>
			)}
			<div className="react-shell-actions">
				{/* Closing after a settled phase is a dismissal, not a rollback: the authorization is
				    gone (disconnected) or untouched (failed). */}
				{isSettled ? (
					<button type="button" className="secondary" onClick={onCancel}>
						Cerrar
					</button>
				) : (
					<button type="button" className="secondary" onClick={onCancel} disabled={isDisconnecting}>
						{confirmation.cancelLabel}
					</button>
				)}
				{state.phase !== "disconnected" && (
					<button
						type="button"
						className="react-gmail-disconnect-confirm"
						onClick={onConfirm}
						disabled={!canConfirm}
						aria-busy={isDisconnecting}
					>
						{isDisconnecting
							? "Desconectando..."
							: state.phase === "failed"
								? "Reintentar"
								: confirmation.confirmLabel}
					</button>
				)}
			</div>
		</dialog>
	);
}

export interface GmailConnectionPanelProps {
	/** Only an authenticated session may read the Gmail status or send a sync. */
	authenticated: boolean;
	/** Connection state the session snapshot reported; shown until the first read settles. */
	initialConnected: boolean;
	/** Connect control slot supplied by the dashboard (unit A's consent-gated control). */
	connectControl: GmailConnectControlSlot;
	/**
	 * Manual sync request built by the dashboard with the configured period and the cycle-first
	 * financial reload, or `null` while no configured period exists. The card only calls it when
	 * the user presses the control, so no render path can start a sync.
	 */
	submitSync?: GmailSyncSubmitter | null;
}

/**
 * Container for the Gmail connection card: it owns the status lifecycle, the disconnection
 * lifecycle, and their single in-flight locks, while every decision they encode stays in
 * `gmailConnection`.
 *
 * It replaces the former static card, which could only repeat the session snapshot: the account
 * state, the email and the failures now come from `/api/gmail/status`, and the disconnection
 * removes the stored authorization through the real endpoint.
 */
export function GmailConnectionPanel({
	authenticated,
	initialConnected,
	connectControl,
	submitSync = null,
}: GmailConnectionPanelProps) {
	const [connection, setConnection] = useState(() =>
		createGmailConnectionState(initialConnected),
	);
	const [disconnect, setDisconnect] = useState<GmailDisconnectState>(createGmailDisconnectState);
	const [disconnectNotice, setDisconnectNotice] = useState<GmailDisconnectNotice | null>(null);
	/** The manual sync lifecycle of this card; every rule it encodes lives in `gmailSync`. */
	const [sync, setSync] = useState<GmailSyncState>(createGmailSyncState);
	/** The C1 synchronous lock, reused for the status read: React state cannot close the async
	 * window, so two same-tick refreshes would otherwise both issue the request. */
	const statusLock = useRef(false);
	/** The same lock, for the disconnection POST. */
	const disconnectLock = useRef(false);

	const refreshStatus = useMemo(
		() => createGmailStatusRefresher({ getStatus: getGmailStatus, lock: statusLock }),
		[],
	);

	const applyStatusOutcome = useCallback((outcome: GmailStatusRefreshOutcome) => {
		setConnection((current) => applyGmailStatusOutcome(current, outcome));
	}, []);

	// The initial read is the mount effect: `startGmailStatusLoad` owns the anonymous-session guard
	// and the cleanup contract, so an anonymous session never reaches the endpoint.
	useEffect(() => {
		return startGmailStatusLoad({
			authenticated,
			getStatus: getGmailStatus,
			lock: statusLock,
			onStarted: () =>
				setConnection((current) => reduceGmailConnection(current, { type: "loadStarted" })),
			onOutcome: applyStatusOutcome,
		});
		// The helper re-reads the latest state through the functional updates above and only depends
		// on the session guard, so the snapshot it closes over can never be stale.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [authenticated]);

	const handleRefreshStatus = useCallback(() => {
		// `startGmailStatusAttempt` acquires the shared lock before its first await, so `started` is
		// known synchronously: only a request that actually left may announce `loading`. A refreshed
		// attempt turned away as `busy` leaves the state reference-identical and announces nothing,
		// so the card never presents a check that is not happening as one in flight.
		const attempt = startGmailStatusAttempt({ getStatus: getGmailStatus, lock: statusLock });
		setConnection((current) => reduceGmailStatusRefreshStart(current, attempt.started));
		void attempt.outcome.then(applyStatusOutcome);
	}, [applyStatusOutcome]);

	const submitDisconnect = useMemo(
		() => createGmailDisconnectSubmitter({ disconnect: disconnectGmail, refreshStatus }),
		[refreshStatus],
	);

	const openDisconnect = useCallback(() => {
		// A previous outcome must not describe the new attempt.
		setDisconnectNotice(null);
		// The lock only closes the same-tick double-click window; the reducer owns the in-flight rule
		// (`open` is a no-op while `disconnecting`), so freeing a previous attempt here cannot re-enable
		// a POST and keeps a retry from being silently blocked.
		releaseInFlightLock(disconnectLock);
		setDisconnect((current) => reduceGmailDisconnectState(current, { type: "open" }));
	}, []);

	const closeDisconnect = useCallback(() => {
		// The notice is published only once the result is dismissed, exactly like the movement flows.
		setDisconnectNotice(getGmailDisconnectNotice(disconnect));
		setDisconnect((current) => reduceGmailDisconnectDismissal(current));
		releaseInFlightLock(disconnectLock);
	}, [disconnect]);

	const confirmDisconnect = useCallback(async () => {
		// Two gates, both owned by the pure module: the phase rule, and the synchronous lock that
		// closes the same-tick window React state cannot close.
		if (!canConfirmGmailDisconnect(disconnect)) return;
		if (!acquireInFlightLock(disconnectLock)) return;
		setDisconnect((current) => reduceGmailDisconnectState(current, { type: "confirm" }));
		try {
			const outcome = await submitDisconnect();
			if (outcome.status === "disconnected") {
				// The authorization is gone: the card stops claiming a connection even when the
				// follow-up read failed, and the dialog reports the truthful outcome.
				setConnection((current) => applyGmailDisconnectOutcome(current, outcome));
				setDisconnect((current) =>
					reduceGmailDisconnectState(current, {
						type: "succeeded",
						gmailStatus: outcome.gmailStatus,
					}),
				);
				return;
			}
			releaseInFlightLock(disconnectLock);
			setDisconnect((current) =>
				reduceGmailDisconnectState(current, { type: "failed", message: outcome.message }),
			);
		} catch {
			// The submitter reports instead of throwing, so this is only reachable if it is replaced:
			// the attempt is over, so the lock is released and the failure is truthful.
			releaseInFlightLock(disconnectLock);
			setDisconnect((current) =>
				reduceGmailDisconnectState(current, {
					type: "failed",
					message: getGmailDisconnectErrorMessage(),
				}),
			);
		}
	}, [disconnect, submitDisconnect]);

	/**
	 * Starts the manual sync. The refusal is checked before the request is created, so an anonymous
	 * session or a card without a configured period cannot even reach the submitter.
	 *
	 * A second start in the same tick is not blocked by the rendered `disabled` attribute: the
	 * reducer keeps the attempt already in flight as the owner of the phase, and the submitter's
	 * synchronous lock reports `busy` for the second call, which maps to nothing at all.
	 */
	const startSync = useCallback(() => {
		if (submitSync === null || !shouldSyncGmail(authenticated)) return;
		setSync((current) => reduceGmailSync(current, { type: "start" }));
		void submitSync()
			.then((outcome) => {
				setSync((current) => reduceGmailSync(current, { type: "settled", outcome }));
			})
			.catch(() => {
				// The submitter reports instead of throwing, so this is only reachable if it is replaced:
				// the attempt is over, so the failure is reported instead of leaving the card syncing.
				setSync((current) =>
					reduceGmailSync(current, {
						type: "settled",
						outcome: { status: "failed", message: getGmailSyncErrorMessage() },
					}),
				);
			});
	}, [authenticated, submitSync]);

	return (
		<>
			<GmailConnectionCard
				state={connection}
				notice={disconnectNotice}
				connectControl={connectControl}
				authenticated={authenticated}
				submitSync={submitSync}
				sync={sync}
				onSync={startSync}
				onRefreshStatus={handleRefreshStatus}
				onOpenDisconnect={openDisconnect}
			/>
			<GmailDisconnectDialog
				isOpen={disconnect.phase !== "closed"}
				state={disconnect}
				onCancel={closeDisconnect}
				onConfirm={confirmDisconnect}
			/>
		</>
	);
}
