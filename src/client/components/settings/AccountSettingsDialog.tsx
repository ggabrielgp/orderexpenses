import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type SyntheticEvent,
} from "react";
import type { SessionProfile } from "../../api/types";
import {
	GmailConnectionPanel,
	type GmailConnectControlSlot,
} from "../gmail/GmailConnectionPanel";
import type { GmailSyncSubmitter } from "../gmail/gmailSync";
import { syncNativeModalDialog } from "../movements/CreateManualExpenseDialog";
import { CategorySettingsContent } from "./CategorySettingsDialog";
import { CounterpartyRulesContent } from "./CounterpartyRulesDialog";
import type { CategoryMutationSubmitter } from "./categorySettings";
import type { CounterpartyRuleSubmitter } from "./counterpartyRules";

/**
 * Unified account settings modal.
 *
 * One native dialog hosts the surfaces the product decision grouped together: the profile
 * identity, the Gmail connection and the category / counterparty administration. The settings
 * bodies are the extracted `CategorySettingsContent` / `CounterpartyRulesContent` sections, and the
 * connection section reuses the shipped `GmailConnectionPanel`, so this modal adds a shell around
 * the verified contracts instead of a second implementation of any of them.
 *
 * It is a real modal through the shared `syncNativeModalDialog` helper, mounted only in the
 * authenticated tree. It offers no logout because parity does not invent a session endpoint.
 *
 * The three surfaces are grouped behind a simple tablist (`Perfil`, `Categorías`,
 * `Reglas de contraparte`) so the modal shows one configuration area at a time. The panels stay
 * mounted and only their visibility is conditional, so switching tabs never drops a section's state
 * or its in-flight lock, and every open starts back on `Perfil`.
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
	/** Only an authenticated session may read or change the Gmail connection. */
	authenticated: boolean;
	/** Connection state the session snapshot reported; the panel shows it until the first read. */
	initialConnected: boolean;
	/** Connect control slot supplied by the dashboard (the consent-gated entry point). */
	connectControl: GmailConnectControlSlot;
	/**
	 * Manual sync request built by the dashboard with the configured period, or `null` while no
	 * configured period exists. The panel only calls it when the user presses the control.
	 */
	submitSync?: GmailSyncSubmitter | null;
	/** Performs the single in-flight category mutation. */
	submitCategoryMutation: CategoryMutationSubmitter;
	/** Performs the single in-flight counterparty rule mutation and its follow-up reload. */
	submitCounterpartyRule: CounterpartyRuleSubmitter;
}

export function AccountSettingsDialog({
	isOpen,
	onClose,
	profile,
	authenticated,
	initialConnected,
	connectControl,
	submitSync = null,
	submitCategoryMutation,
	submitCounterpartyRule,
}: AccountSettingsDialogProps) {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const [busy, setBusy] = useState({ category: false, counterparty: false });
	// Which of the three grouped surfaces is visible. The panels stay mounted so each embedded
	// section keeps its state, its in-flight lock and the Gmail state machine intact across tab
	// switches; only visibility is conditional.
	const [activeTab, setActiveTab] = useState<"profile" | "categories" | "counterparty">(
		"profile",
	);

	useEffect(() => {
		syncNativeModalDialog(dialogRef.current, isOpen);
	}, [isOpen]);

	// Every open starts on `Perfil`: the modal keeps its component instance between opens, so the
	// selection is reset instead of inheriting the tab the previous session left behind.
	useEffect(() => {
		if (isOpen) setActiveTab("profile");
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
			{/* A plain tablist of native buttons: `aria-selected` marks the active tab and each panel
			    names it back through `aria-labelledby`. Inactive panels stay mounted but hidden, so no
			    embedded section loses its state when the selection changes. */}
			<div
				className="react-account-settings-tabs"
				role="tablist"
				aria-label="Secciones de la configuración"
			>
				<button
					type="button"
					role="tab"
					id="react-account-settings-tab-profile"
					className="react-account-settings-tab"
					aria-selected={activeTab === "profile"}
					aria-controls="react-account-settings-panel-profile"
					onClick={() => setActiveTab("profile")}
				>
					Perfil
				</button>
				<button
					type="button"
					role="tab"
					id="react-account-settings-tab-categories"
					className="react-account-settings-tab"
					aria-selected={activeTab === "categories"}
					aria-controls="react-account-settings-panel-categories"
					onClick={() => setActiveTab("categories")}
				>
					Categorías
				</button>
				<button
					type="button"
					role="tab"
					id="react-account-settings-tab-counterparty"
					className="react-account-settings-tab"
					aria-selected={activeTab === "counterparty"}
					aria-controls="react-account-settings-panel-counterparty"
					onClick={() => setActiveTab("counterparty")}
				>
					Reglas de contraparte
				</button>
			</div>
			<div
				role="tabpanel"
				id="react-account-settings-panel-profile"
				className="react-account-settings-panel"
				aria-labelledby="react-account-settings-tab-profile"
				hidden={activeTab !== "profile"}
			>
				<section
					className="react-account-settings-profile"
					aria-labelledby="react-account-settings-profile-title"
				>
					<span className="section-kicker">Sesión actual</span>
					<h3 id="react-account-settings-profile-title">Perfil</h3>
					<strong>{profile?.name || "Usuario conectado"}</strong>
					<p>{profile?.email || "No hay un perfil de Gmail asociado a esta sesión."}</p>
				</section>
				{/* The connection state machine keeps its single owner in the shipped panel; the modal only
				    gives it a home inside the account surface. */}
				<section className="react-account-settings-gmail" aria-label="Conexión con Gmail">
					<GmailConnectionPanel
						authenticated={authenticated}
						initialConnected={initialConnected}
						connectControl={connectControl}
						submitSync={submitSync}
					/>
				</section>
			</div>
			<div
				role="tabpanel"
				id="react-account-settings-panel-categories"
				className="react-account-settings-panel"
				aria-labelledby="react-account-settings-tab-categories"
				hidden={activeTab !== "categories"}
			>
				{/* The verified category body fills its own section; the modal supplies the shell. */}
				<CategorySettingsContent
					isOpen={isOpen}
					submitMutation={submitCategoryMutation}
					onBusyChange={handleCategoryBusyChange}
				/>
			</div>
			<div
				role="tabpanel"
				id="react-account-settings-panel-counterparty"
				className="react-account-settings-panel"
				aria-labelledby="react-account-settings-tab-counterparty"
				hidden={activeTab !== "counterparty"}
			>
				<h3 className="react-account-settings-section-title">Reglas de contraparte</h3>
				{/* The verified counterparty body, embedded without its own close control. */}
				<CounterpartyRulesContent
					isOpen={isOpen}
					submitMutation={submitCounterpartyRule}
					onBusyChange={handleCounterpartyBusyChange}
				/>
			</div>
			<div className="react-shell-actions">
				<button type="button" className="secondary" onClick={onClose} disabled={isMutating}>
					Cerrar
				</button>
			</div>
		</dialog>
	);
}
