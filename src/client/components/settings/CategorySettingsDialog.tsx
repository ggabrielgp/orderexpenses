import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type FormEvent,
	type SyntheticEvent,
} from "react";
import { getCategories } from "../../api/client";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import {
	MAX_CATEGORY_NAME_LENGTH,
	createCategoryCatalogState,
	createCategoryDraft,
	getCategoryDeleteConfirmation,
	getCategoryDisplayRows,
	getCategoryMutationFailureMessage,
	reduceCategoryCatalog,
	shouldClearCategoryMutationPhase,
	validateCategoryDraft,
	type CategoryCatalogState,
	type CategoryDeleteConfirmation,
	type CategoryDisplayRow,
	type CategoryDraft,
	type CategoryMutation,
	type CategoryMutationOutcome,
	type CategoryMutationSubmitter,
} from "./categorySettings";

/**
 * Category administration surface.
 *
 * Every decision it renders comes from `categorySettings`: validation happens there (and again
 * inside the submitter), the rows and their labels come from the catalog derivation, and the delete
 * confirmation copy comes from the pure function that states the real consequence. These components
 * own only React state.
 *
 * The stateful body is extracted as `CategorySettingsContent` so the standalone `Configuración`
 * dialog and the unified `AccountSettingsDialog` render the exact same section, form and mutation
 * runner instead of two copies that could drift apart. The standalone dialog keeps its own native
 * `<dialog>` shell and close control; the unified modal embeds the content and owns a single outer
 * close control.
 *
 * The standalone dialog is a real modal through the same `syncNativeModalDialog` helper as the
 * movement, Gmail and rename dialogs, so it has the focus trap, `Esc` handling and inert backdrop of
 * every other modal in this surface instead of the bare non-modal markup `<dialog open>` would
 * produce.
 *
 * Deletion is confirmed in place, inside the row, rather than through a second nested modal: the
 * surface is already modal, and the confirmation is a single, explicit step whose copy is the one
 * the product decision requires.
 */

type CategoryStatusTone = "pending" | "success" | "error";

type CategoryStatus = {
	message: string;
	tone: CategoryStatusTone;
};

const CATEGORY_MUTATION_PENDING_MESSAGE = "Guardando los cambios de categorías...";
const CATEGORY_SAVED_MESSAGE = "Categoría guardada.";
const CATEGORY_DELETED_MESSAGE = "Categoría eliminada.";

export interface CategorySettingsRowProps {
	row: CategoryDisplayRow;
	/** Confirmation copy when this row is the one awaiting confirmation; `null` otherwise. */
	confirmation: CategoryDeleteConfirmation | null;
	/** Set while a mutation is in flight, so no second one can be offered. */
	busy: boolean;
	onRequestDelete: (name: string) => void;
	onCancelDelete: () => void;
	onConfirmDelete: (name: string) => void;
}

/**
 * One catalog row. Exported so the builtin/custom distinction and the confirmation copy are
 * provable from markup instead of from a source-text guess.
 */
export function CategorySettingsRow({
	row,
	confirmation,
	busy,
	onRequestDelete,
	onCancelDelete,
	onConfirmDelete,
}: CategorySettingsRowProps) {
	return (
		<li className="react-category-row">
			<span
				className="react-category-badge"
				style={{ "--category-color": row.color } as CSSProperties}
			>
				{row.name}
			</span>
			<small className="react-category-origin">{row.label}</small>
			<div className="react-category-row-actions">
				{/* A builtin is listed but protected: no delete control is rendered for it at all. */}
				{row.canDelete && confirmation === null && (
					<button
						type="button"
						className="secondary react-category-delete"
						onClick={() => onRequestDelete(row.name)}
						disabled={busy}
					>
						Eliminar
					</button>
				)}
			</div>
			{confirmation !== null && (
				<div
					className="react-category-delete-confirmation"
					role="group"
					aria-label={confirmation.title}
				>
					<p>{confirmation.message}</p>
					<div className="react-shell-actions">
						<button
							type="button"
							className="secondary react-category-delete-cancel"
							onClick={onCancelDelete}
							disabled={busy}
						>
							{confirmation.cancelLabel}
						</button>
						<button
							type="button"
							className="react-category-delete-confirm"
							onClick={() => onConfirmDelete(confirmation.name)}
							disabled={busy}
						>
							{confirmation.confirmLabel}
						</button>
					</div>
				</div>
			)}
		</li>
	);
}

export interface CategorySettingsContentProps {
	/** The parent owns visibility; the content only loads and mutates while the surface is open. */
	isOpen: boolean;
	/** Performs the single in-flight mutation; rejects only through its returned outcome. */
	submitMutation: CategoryMutationSubmitter;
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
 * The stateful category administration body: catalog load, draft, in-place delete confirmation,
 * mutation runner and truthful status line.
 *
 * It is the reusable half of the surface, so it computes nothing the standalone dialog used to
 * compute. The mounted surface owns naming and dismissal; this section owns the behaviour.
 */
export function CategorySettingsContent({
	isOpen,
	submitMutation,
	onClose,
	onBusyChange,
}: CategorySettingsContentProps) {
	const [catalog, setCatalog] = useState<CategoryCatalogState>(createCategoryCatalogState);
	const [catalogToken, setCatalogToken] = useState(0);
	const [draft, setDraft] = useState<CategoryDraft>(createCategoryDraft);
	const [status, setStatus] = useState<CategoryStatus | null>(null);
	const [isMutating, setIsMutating] = useState(false);
	/** Name awaiting the delete confirmation; `null` while no confirmation is open. */
	const [confirmingDeleteName, setConfirmingDeleteName] = useState<string | null>(null);

	// Opening always starts a fresh surface: no previous outcome, draft or confirmation leaks into
	// a new attempt.
	useEffect(() => {
		if (!isOpen) return;
		setDraft(createCategoryDraft());
		setStatus(null);
		setIsMutating(false);
		setConfirmingDeleteName(null);
	}, [isOpen]);

	// The catalog is only requested while the surface is open, so a dashboard that never opens
	// `Configuración` never asks for it.
	useEffect(() => {
		if (!isOpen) return;
		const controller = new AbortController();
		setCatalog((current) => reduceCategoryCatalog(current, { type: "loadStarted" }));
		getCategories(controller.signal)
			.then((categories) => {
				if (controller.signal.aborted) return;
				setCatalog((current) =>
					reduceCategoryCatalog(current, { type: "loaded", categories }),
				);
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setCatalog((current) => reduceCategoryCatalog(current, { type: "loadFailed" }));
				}
			});
		return () => controller.abort();
	}, [isOpen, catalogToken]);

	// The owning dialog learns about the in-flight phase so it can refuse dismissal mid-request,
	// without this section lifting its mutation state into every caller.
	useEffect(() => {
		onBusyChange?.(isMutating);
	}, [isMutating, onBusyChange]);

	const rows = getCategoryDisplayRows(catalog.categories);

	/**
	 * Runs one mutation and reports exactly what happened.
	 *
	 * A failed mutation never claims success, and it keeps the draft on screen so the user can
	 * correct it. A success re-reads the catalog from the server instead of patching the list
	 * locally, so the rows show what the server now holds.
	 *
	 * The in-flight phase is released only by an outcome that settled this attempt. The submitter
	 * this app wires in (`createCategoryMutationSubmitter`) reports every rejection through its
	 * returned outcome and cannot throw, so the `catch` only guarantees that a throwing
	 * implementation still leaves the surface unlocked instead of stuck forever.
	 */
	const runMutation = async (mutation: CategoryMutation) => {
		setStatus({ message: CATEGORY_MUTATION_PENDING_MESSAGE, tone: "pending" });
		setIsMutating(true);
		const outcome: CategoryMutationOutcome = await submitMutation(mutation).catch(
			(error): CategoryMutationOutcome => ({
				status: "failed",
				message: getCategoryMutationFailureMessage(error),
			}),
		);
		// Another attempt still holds the lock, so its outcome is the only truthful one: this attempt
		// reports nothing and the pending state stays, because a mutation is in flight. Only the
		// attempt that owns the lock clears it when it settles.
		if (!shouldClearCategoryMutationPhase(outcome)) return;
		setIsMutating(false);
		if (outcome.status === "failed") {
			setStatus({ message: outcome.message, tone: "error" });
			return;
		}
		if (outcome.status === "saved") {
			setDraft((current) => ({ ...current, name: "" }));
			setStatus({ message: CATEGORY_SAVED_MESSAGE, tone: "success" });
		} else {
			setStatus({ message: CATEGORY_DELETED_MESSAGE, tone: "success" });
		}
		setCatalogToken((token) => token + 1);
	};

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isMutating) return;
		const validation = validateCategoryDraft(draft);
		if (!validation.ok) {
			// Nothing was sent, so this is an invalid draft, not a rejected request, and every
			// entered value stays so it can be corrected.
			setStatus({ message: validation.message, tone: "error" });
			return;
		}
		void runMutation({ type: "upsert", draft });
	};

	const requestDelete = (name: string) => setConfirmingDeleteName(name);

	const confirmDelete = (name: string) => {
		// The confirmation is consumed by the attempt: a failure is reported by the status line and
		// the row stays available, so a retry is still possible.
		setConfirmingDeleteName(null);
		void runMutation({ type: "delete", name });
	};

	// Closed means nothing to render: the mounted dialog decides when the surface is visible.
	if (!isOpen) return null;

	return (
		<>
			<section className="react-category-section" aria-labelledby="react-category-list-title">
				<h3 id="react-category-list-title">Categorías</h3>
				{/* Loading, loaded-and-empty and failed are three different truths: a failed load must
				    never read as "loading", and the empty catalog has its own message. */}
				{rows.length > 0 && (
					<ul className="react-category-list">
						{rows.map((row, index) => (
							<CategorySettingsRow
								key={`${row.name}-${index}`}
								row={row}
								confirmation={
									confirmingDeleteName === row.name && row.canDelete
										? getCategoryDeleteConfirmation(row.name)
										: null
								}
								busy={isMutating}
								onRequestDelete={requestDelete}
								onCancelDelete={() => setConfirmingDeleteName(null)}
								onConfirmDelete={confirmDelete}
							/>
						))}
					</ul>
				)}
				{catalog.phase === "ready" ? (
					rows.length === 0 && (
						<p className="react-category-loading" role="status">
							No hay categorías guardadas todavía.
						</p>
					)
				) : (
					catalog.errorMessage === null && (
						<p className="react-category-loading" role="status">
							Cargando categorías...
						</p>
					)
				)}
				{catalog.errorMessage !== null && (
					<div className="react-category-catalog-error" role="status">
						<p>{catalog.errorMessage}</p>
						<button
							type="button"
							className="secondary react-category-catalog-retry"
							onClick={() => setCatalogToken((token) => token + 1)}
							disabled={isMutating}
						>
							Reintentar carga
						</button>
					</div>
				)}
			</section>
			<form className="react-category-form" onSubmit={handleSubmit} aria-busy={isMutating}>
				<label htmlFor="category-settings-name">
					<span>Nombre</span>
					<input
						id="category-settings-name"
						name="name"
						type="text"
						maxLength={MAX_CATEGORY_NAME_LENGTH}
						value={draft.name}
						placeholder="Nombre de la categoría"
						onChange={(event) =>
							setDraft((current) => ({ ...current, name: event.target.value }))
						}
						disabled={isMutating}
					/>
				</label>
				<label htmlFor="category-settings-color">
					<span>Color</span>
					<input
						id="category-settings-color"
						name="color"
						type="color"
						value={draft.color}
						onChange={(event) =>
							setDraft((current) => ({ ...current, color: event.target.value }))
						}
						disabled={isMutating}
					/>
				</label>
				<small className="react-category-form-help">
					Guardar con el nombre de una categoría existente reemplaza su color. También se
					puede reemplazar una categoría predeterminada: pasará a figurar como
					personalizada.
				</small>
				<div className="react-shell-actions">
					<button type="submit" disabled={isMutating}>
						{isMutating ? "Guardando..." : "Guardar categoría"}
					</button>
				</div>
			</form>
			{status !== null && (
				<p
					className={`react-category-status react-category-status-${status.tone}`}
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

export interface CategorySettingsDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** Dismissal intent. It never re-sends a mutation. */
	onClose: () => void;
	/** Performs the single in-flight mutation; rejects only through its returned outcome. */
	submitMutation: CategoryMutationSubmitter;
}

/**
 * Standalone native modal for category administration. It is the shipped shell around
 * `CategorySettingsContent`; the unified settings modal renders the same content inside its own
 * dialog instead of mounting this one.
 */
export function CategorySettingsDialog({
	isOpen,
	onClose,
	submitMutation,
}: CategorySettingsDialogProps) {
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

	// Closed means unmounted, exactly like the Gmail consent and removal dialogs: the native
	// element only exists while the surface is open, and the effect above opens it on that render.
	if (!isOpen) return null;

	return (
		<dialog
			ref={dialogRef}
			className="react-settings-dialog react-category-dialog"
			aria-labelledby="react-category-settings-title"
			onCancel={handleDialogCancel}
			onClose={onClose}
		>
			<h2 id="react-category-settings-title">Configuración</h2>
			<CategorySettingsContent
				isOpen={isOpen}
				submitMutation={submitMutation}
				onClose={onClose}
				onBusyChange={handleBusyChange}
			/>
		</dialog>
	);
}
