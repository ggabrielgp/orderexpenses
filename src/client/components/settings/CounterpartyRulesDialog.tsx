import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent,
	type SyntheticEvent,
} from "react";
import { getCategories, getCounterpartyRules } from "../../api/client";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import { getCategoryDisplayRows } from "./categorySettings";
import {
	NO_CATEGORY_LABEL,
	NO_CATEGORY_VALUE,
	UNCHOSEN_CATEGORY_VALUE,
	createCounterpartyRuleDraft,
	createCounterpartyRuleListState,
	getCounterpartyRuleMutationFailureMessage,
	getCounterpartyRuleNotice,
	getCounterpartyRuleRows,
	reduceCounterpartyRuleList,
	shouldClearCounterpartyRuleMutationPhase,
	validateCounterpartyRuleDraft,
	type CounterpartyRuleDraft,
	type CounterpartyRuleListState,
	type CounterpartyRuleRow,
	type CounterpartyRuleSubmitOutcome,
	type CounterpartyRuleSubmitter,
} from "./counterpartyRules";

/**
 * `Reglas de contraparte` surface.
 *
 * The server applies these rules while it loads movements, so this is a list plus free entry, not a
 * movement editor: the user types a counterparty and picks a category, and the dashboard reloads
 * the configured period so the rule becomes visible. Everything decided here comes from
 * `counterpartyRules`; these components own only React state.
 *
 * The stateful body is extracted as `CounterpartyRulesContent` so the standalone dialog and the
 * unified `AccountSettingsDialog` render the exact same list, form and mutation runner instead of
 * two copies that could drift apart. The standalone dialog keeps its own native `<dialog>` shell,
 * its heading and its close control; the unified modal embeds the content under its own section
 * heading and owns a single outer close control.
 *
 * The standalone dialog is a real modal through the shared `syncNativeModalDialog` helper, and the
 * content is mounted only from the authenticated tree, so the read-only demo never renders it.
 */

type CounterpartyStatusTone = "pending" | "success" | "warning" | "error";

type CounterpartyStatus = {
	message: string;
	tone: CounterpartyStatusTone;
};

const PENDING_SAVE_MESSAGE = "Guardando la regla de contraparte...";
const PENDING_CLEAR_MESSAGE = "Quitando la regla de contraparte...";

export interface CounterpartyRuleRowProps {
	row: CounterpartyRuleRow;
}

/** One stored rule. Exported so the list markup is provable from rendered output. */
export function CounterpartyRuleRow({ row }: CounterpartyRuleRowProps) {
	return (
		<li className="react-counterparty-rule-row">
			<span>
				<strong className="react-counterparty-rule-name">{row.displayName}</strong>
				<small className="react-counterparty-rule-origin">{row.categoryLabel}</small>
			</span>
		</li>
	);
}

export interface CounterpartyRulesListProps {
	state: CounterpartyRuleListState;
}

/**
 * The stored rules with their three truthful states. A failed load must never read as "loading",
 * an empty list has its own message, and a failed refresh keeps the last known rows on screen
 * instead of presenting a network failure as if the rules had been deleted.
 */
export function CounterpartyRulesList({ state }: CounterpartyRulesListProps) {
	const rows = getCounterpartyRuleRows(state.rules);
	return (
		<>
			{rows.length > 0 && (
				<ul className="react-counterparty-list">
					{rows.map((row, index) => (
						<CounterpartyRuleRow key={`${row.key}-${index}`} row={row} />
					))}
				</ul>
			)}
			{state.phase === "ready" ? (
				rows.length === 0 && (
					<p className="react-counterparty-loading" role="status">
						No hay reglas guardadas todavía.
					</p>
				)
			) : (
				state.errorMessage === null && (
					<p className="react-counterparty-loading" role="status">
						Cargando reglas de contraparte...
					</p>
				)
			)}
			{state.errorMessage !== null && (
				<p className="react-counterparty-load-error" role="status">
					{state.errorMessage}
				</p>
			)}
		</>
	);
}

export interface CounterpartyRulesContentProps {
	/** The parent owns visibility; the content only loads and mutates while the surface is open. */
	isOpen: boolean;
	/** Performs the single in-flight mutation and its follow-up period reload. */
	submitMutation: CounterpartyRuleSubmitter;
	/**
	 * Renders this section's own close control when provided. The standalone dialog passes its
	 * dismissal handler; the unified settings modal omits it so a single outer control closes the
	 * whole surface.
	 */
	onClose?: () => void;
	/**
	 * Reports the in-flight phase to the owning dialog, which uses it to refuse `Esc` while a
	 * request is unsettled. It is a callback instead of lifted state so the dialog does not have to
	 * re-render on every mutation.
	 */
	onBusyChange?: (busy: boolean) => void;
}

/**
 * The stateful counterparty-rule body: stored-rule load, category catalog for the select, draft,
 * mutation runner and truthful status line.
 *
 * The mounted surface owns the section heading and dismissal; this section owns the behaviour, so
 * the unified modal is a new shell around verified logic rather than a second implementation.
 */
export function CounterpartyRulesContent({
	isOpen,
	submitMutation,
	onClose,
	onBusyChange,
}: CounterpartyRulesContentProps) {
	const [list, setList] = useState<CounterpartyRuleListState>(createCounterpartyRuleListState);
	const [listToken, setListToken] = useState(0);
	const [draft, setDraft] = useState<CounterpartyRuleDraft>(createCounterpartyRuleDraft);
	const [status, setStatus] = useState<CounterpartyStatus | null>(null);
	const [isMutating, setIsMutating] = useState(false);
	const [categoryNames, setCategoryNames] = useState<string[]>([]);
	const [categoryCatalogFailed, setCategoryCatalogFailed] = useState(false);
	const [categoryToken, setCategoryToken] = useState(0);

	// Opening always starts a fresh surface: no previous outcome or draft leaks into a new attempt.
	useEffect(() => {
		if (!isOpen) return;
		setDraft(createCounterpartyRuleDraft());
		setStatus(null);
		setIsMutating(false);
	}, [isOpen]);

	// The rules are only requested while the surface is open, so a dashboard that never opens this
	// surface never asks for them. A settled mutation re-runs this effect through `listToken`, which
	// is what makes the list show what the server now holds.
	useEffect(() => {
		if (!isOpen) return;
		const controller = new AbortController();
		setList((current) => reduceCounterpartyRuleList(current, { type: "loadStarted" }));
		getCounterpartyRules(controller.signal)
			.then((rules) => {
				if (controller.signal.aborted) return;
				setList((current) => reduceCounterpartyRuleList(current, { type: "loaded", rules }));
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setList((current) => reduceCounterpartyRuleList(current, { type: "loadFailed" }));
				}
			});
		return () => controller.abort();
	}, [isOpen, listToken]);

	// The merged catalog `GET /api/categories` returns. Reusing the shipped derivation keeps the
	// options sorted the way the category surface lists them and drops the nameless rows a rule
	// could not store either.
	useEffect(() => {
		if (!isOpen) return;
		const controller = new AbortController();
		setCategoryCatalogFailed(false);
		getCategories(controller.signal)
			.then((categories) => {
				if (controller.signal.aborted) return;
				setCategoryNames(getCategoryDisplayRows(categories).map((row) => row.name));
			})
			.catch(() => {
				if (!controller.signal.aborted) setCategoryCatalogFailed(true);
			});
		return () => controller.abort();
	}, [isOpen, categoryToken]);

	// The owning dialog learns about the in-flight phase so it can refuse dismissal mid-request,
	// without this section lifting its mutation state into every caller.
	useEffect(() => {
		onBusyChange?.(isMutating);
	}, [isMutating, onBusyChange]);

	/**
	 * Runs one mutation and reports exactly what happened.
	 *
	 * A failure never claims success and keeps the entered values so they can be corrected. A settled
	 * mutation re-reads the stored rules from the server instead of patching the list locally, because
	 * the server owns their order. The in-flight phase is released only by an outcome that settled this
	 * attempt, so a same-tick second submission cannot re-enable the controls behind the first request.
	 */
	const runMutation = async (submitted: CounterpartyRuleDraft) => {
		setStatus({
			message: submitted.category === NO_CATEGORY_VALUE ? PENDING_CLEAR_MESSAGE : PENDING_SAVE_MESSAGE,
			tone: "pending",
		});
		setIsMutating(true);
		const outcome: CounterpartyRuleSubmitOutcome = await submitMutation(submitted).catch(
			(error): CounterpartyRuleSubmitOutcome => ({
				status: "failed",
				message: getCounterpartyRuleMutationFailureMessage(error),
			}),
		);
		if (!shouldClearCounterpartyRuleMutationPhase(outcome)) return;
		setIsMutating(false);
		if (outcome.status === "failed") {
			setStatus({ message: outcome.message, tone: "error" });
			return;
		}
		setDraft(createCounterpartyRuleDraft());
		setStatus(getCounterpartyRuleNotice(outcome));
		setListToken((token) => token + 1);
	};

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isMutating) return;
		const validation = validateCounterpartyRuleDraft(draft);
		if (!validation.ok) {
			// Nothing was sent, so this is an invalid draft, not a rejected request.
			setStatus({ message: validation.message, tone: "error" });
			return;
		}
		void runMutation(draft);
	};

	// Closed means nothing to render: the mounted dialog decides when the surface is visible.
	if (!isOpen) return null;

	// The control names the outcome it will produce, so the clearing choice is visible before it is
	// pressed instead of reading as a save.
	const isClearing = draft.category === NO_CATEGORY_VALUE;
	const submitLabel = isMutating
		? isClearing
			? "Quitando..."
			: "Guardando..."
		: isClearing
			? "Quitar regla"
			: "Guardar regla";

	return (
		<>
			<p className="react-counterparty-intro">
				Cada regla reemplaza la categoría de los movimientos cuya contraparte coincida. Se
				aplican al cargar los movimientos, así que el periodo se actualiza al guardar.
			</p>
			<section
				className="react-counterparty-section"
				aria-labelledby="react-counterparty-list-title"
			>
				<h3 id="react-counterparty-list-title">Reglas guardadas</h3>
				<CounterpartyRulesList state={list} />
				{list.errorMessage !== null && (
					<button
						type="button"
						className="secondary react-counterparty-list-retry"
						onClick={() => setListToken((token) => token + 1)}
						disabled={isMutating}
					>
						Reintentar carga
					</button>
				)}
			</section>
			<form className="react-counterparty-form" onSubmit={handleSubmit} aria-busy={isMutating}>
				<label htmlFor="counterparty-rule-name">
					<span>Contraparte</span>
					<input
						id="counterparty-rule-name"
						name="counterparty"
						type="text"
						value={draft.counterparty}
						placeholder="Nombre de la contraparte"
						onChange={(event) =>
							setDraft((current) => ({ ...current, counterparty: event.target.value }))
						}
						disabled={isMutating}
					/>
				</label>
				<label htmlFor="counterparty-rule-category">
					<span>Categoría</span>
					<select
						id="counterparty-rule-category"
						name="category"
						// `null` is the untouched draft, rendered through a placeholder the select cannot offer as a
						// real choice (`disabled`), so the sentinel is unreachable from the UI. Selecting a real
						// option is the only way the draft leaves `null`.
						value={draft.category ?? UNCHOSEN_CATEGORY_VALUE}
						onChange={(event) => {
							// The change handler reads the placeholder as "still unchosen" instead of storing the
							// sentinel, which is the other half of the guarantee that it never becomes a payload.
							const picked = event.target.value;
							setDraft((current) => ({
								...current,
								category: picked === UNCHOSEN_CATEGORY_VALUE ? null : picked,
							}));
						}}
						disabled={isMutating}
					>
						<option value={UNCHOSEN_CATEGORY_VALUE} disabled>
							Elige una categoría
						</option>
						<option value={NO_CATEGORY_VALUE}>{NO_CATEGORY_LABEL}</option>
						{categoryNames.map((name) => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					</select>
				</label>
				<small className="react-counterparty-form-help">
					Elegir {NO_CATEGORY_LABEL} quita la regla y la contraparte conserva su categoría
					detectada.
				</small>
				{categoryCatalogFailed && (
					<div className="react-counterparty-form-error" role="status">
						<p>
							No se pudieron cargar las categorías, así que solo puedes elegir{" "}
							{NO_CATEGORY_LABEL} para quitar una regla.
						</p>
						<button
							type="button"
							className="secondary react-counterparty-category-retry"
							onClick={() => setCategoryToken((token) => token + 1)}
							disabled={isMutating}
						>
							Reintentar categorías
						</button>
					</div>
				)}
				<div className="react-shell-actions">
					<button type="submit" disabled={isMutating}>
						{submitLabel}
					</button>
				</div>
			</form>
			{status !== null && (
				<p
					className={`react-counterparty-status react-counterparty-status-${status.tone}`}
					role={status.tone === "error" ? "alert" : "status"}
				>
					{status.message}
				</p>
			)}
			{/* The standalone dialog keeps this section's own dismissal; the unified modal omits it
			    so a single outer control closes the whole surface. */}
			{onClose !== undefined && (
				<div className="react-shell-actions">
					<button type="button" className="secondary" onClick={onClose} disabled={isMutating}>
						Cerrar
					</button>
				</div>
			)}
		</>
	);
}

export interface CounterpartyRulesDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** Dismissal intent. It never re-sends a mutation. */
	onClose: () => void;
	/** Performs the single in-flight mutation and its follow-up period reload. */
	submitMutation: CounterpartyRuleSubmitter;
}

/**
 * Standalone native modal for counterparty rules. It is the shipped shell around
 * `CounterpartyRulesContent`; the unified settings modal renders the same content inside its own
 * dialog instead of mounting this one.
 */
export function CounterpartyRulesDialog({
	isOpen,
	onClose,
	submitMutation,
}: CounterpartyRulesDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const [isMutating, setIsMutating] = useState(false);

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	// The section reports its in-flight phase so `Esc` cannot hide a mutation already on its way.
	const handleBusyChange = useCallback((busy: boolean) => setIsMutating(busy), []);

	const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
		if (isMutating) event.preventDefault();
	};

	// Closed means unmounted, exactly like the other dialogs: the native element only exists while
	// the surface is open, and the effect above opens it on that render.
	if (!isOpen) return null;

	return (
		<dialog
			ref={dialogRef}
			className="react-settings-dialog react-counterparty-dialog"
			aria-labelledby="react-counterparty-rules-title"
			onCancel={handleDialogCancel}
			onClose={onClose}
		>
			<h2 id="react-counterparty-rules-title">Reglas de contraparte</h2>
			<CounterpartyRulesContent
				isOpen={isOpen}
				submitMutation={submitMutation}
				onClose={onClose}
				onBusyChange={handleBusyChange}
			/>
		</dialog>
	);
}
