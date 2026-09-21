import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type SyntheticEvent,
} from "react";
import type { SessionProfile } from "../../api/types";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import { CategorySettingsContent } from "./CategorySettingsDialog";
import { CounterpartyRulesContent } from "./CounterpartyRulesDialog";
import type { CategoryMutationSubmitter } from "./categorySettings";
import type { CounterpartyRuleSubmitter } from "./counterpartyRules";

/**
 * Unified account settings modal.
 *
 * One native dialog hosts the three surfaces the product decision grouped together: the profile
 * identity, category administration and counterparty rules. Both settings bodies are the extracted
 * `CategorySettingsContent` / `CounterpartyRulesContent` sections, so this modal adds a shell and a
 * profile header instead of a second implementation of the verified mutation contracts.
 *
 * It is a real modal through the shared `syncNativeModalDialog` helper, mounted only in the
 * authenticated tree. Gmail keeps its own connection state machine in the body panel; this modal
 * neither duplicates nor relocates it, and it offers no logout because parity does not invent a
 * session endpoint.
 *
 * There is one outer close control. Each embedded section hides its individual close button by
 * omitting `onClose`, so the modal presents a single dismissal for the whole surface. While either
 * section has a mutation in flight, `Esc` is refused and the close control is disabled: a settled
 * request is the only thing that may dismiss the surface, exactly like the standalone dialogs.
 */
export interface AccountSettingsDialogProps {
	/** The parent owns visibility; the dialog only opens or closes the native element. */
	isOpen: boolean;
	/** Dismissal intent. It never re-sends a mutation. */
	onClose: () => void;
	/** Session profile; `null` renders the same safe fallback the body identity card shows. */
	profile: SessionProfile | null;
	/** Performs the single in-flight category mutation. */
	submitCategoryMutation: CategoryMutationSubmitter;
	/** Performs the single in-flight counterparty rule mutation and its follow-up reload. */
	submitCounterpartyRule: CounterpartyRuleSubmitter;
}

export function AccountSettingsDialog({
	isOpen,
	onClose,
	profile,
	submitCategoryMutation,
	submitCounterpartyRule,
}: AccountSettingsDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const [busy, setBusy] = useState({ category: false, counterparty: false });

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	// Each section reports its in-flight phase; the dialog refuses `Esc` while any request is
	// unsettled, so a mutation already on its way cannot be hidden by a dismissal.
	const handleCategoryBusyChange = useCallback((value: boolean) => {
		setBusy((current) => (current.category === value ? current : { ...current, category: value }));
	}, []);
	const handleCounterpartyBusyChange = useCallback((value: boolean) => {
		setBusy((current) =>
			current.counterparty === value ? current : { ...current, counterparty: value },
		);
	}, []);

	const isMutating = busy.category || busy.counterparty;

	const handleDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
		if (isMutating) event.preventDefault();
	};

	// Closed means unmounted, exactly like the standalone dialogs: the native element only exists
	// while the surface is open, and the effect above opens it on that render.
	if (!isOpen) return null;

	return (
		<dialog
			ref={dialogRef}
			className="react-settings-dialog react-account-settings-dialog"
			aria-labelledby="react-account-settings-title"
			onCancel={handleDialogCancel}
			onClose={onClose}
		>
			<h2 id="react-account-settings-title">Configuración</h2>
			<section
				className="react-account-settings-profile"
				aria-labelledby="react-account-settings-profile-title"
			>
				<h3 id="react-account-settings-profile-title">Perfil</h3>
				<strong>{profile?.name || "Usuario conectado"}</strong>
				<p>{profile?.email || "No hay un perfil de Gmail asociado a esta sesión."}</p>
			</section>
			{/* The verified category body fills its own section; the modal supplies the shell. */}
			<CategorySettingsContent
				isOpen={isOpen}
				submitMutation={submitCategoryMutation}
				onBusyChange={handleCategoryBusyChange}
			/>
			<h3 className="react-account-settings-section-title">Reglas de contraparte</h3>
			{/* The verified counterparty body, embedded without its own close control. */}
			<CounterpartyRulesContent
				isOpen={isOpen}
				submitMutation={submitCounterpartyRule}
				onBusyChange={handleCounterpartyBusyChange}
			/>
			<div className="react-shell-actions">
				<button type="button" className="secondary" onClick={onClose} disabled={isMutating}>
					Cerrar
				</button>
			</div>
		</dialog>
	);
}
