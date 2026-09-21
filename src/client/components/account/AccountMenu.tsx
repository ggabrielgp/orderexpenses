import {
	Children,
	cloneElement,
	isValidElement,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	type KeyboardEvent,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	type Ref,
} from "react";
import type { SessionProfile } from "../../api/types";
import {
	ACCOUNT_MENU_ID,
	createAccountMenuState,
	getAccountIdentity,
	getAccountMenuTriggerAttributes,
	getMenuNavigationDirection,
	getMenuItemNavigationIndex,
	reduceAccountMenu,
	type AccountIdentity,
} from "./accountMenu";

/**
 * The authenticated account menu.
 *
 * It renders the profile trigger and, inside the same disclosure, the settings actions the header
 * used to expose as standalone buttons. The caller owns those actions (and therefore their
 * already-verified dialogs and mutation contracts); this component only provides the menu shell,
 * its accessibility semantics and its keyboard/pointer behaviour.
 *
 * Only mount it in the authenticated tree: the demo composition never renders it, which keeps the
 * read-only demo free of account surfaces by construction.
 */
export interface AccountMenuProps {
	/** `session.profile`; `null` resolves to a safe, labelled fallback identity. */
	profile: SessionProfile | null;
	/** Menu actions. Every focusable child is rendered as a `role="menuitem"` with a managed tab stop. */
	children: ReactNode;
	/** Menu element id; the trigger always references it. */
	menuId?: string;
}

/**
 * Presentational shell, exported so the menu semantics and the avatar fallback are provable from a
 * static render while the stateful wrapper owns the DOM-only behaviour. Tests render it directly
 * because the open state cannot be reached without a browser.
 */
export interface AccountMenuViewProps {
	/** The already-resolved identity to render. */
	identity: AccountIdentity;
	/** Whether the menu region is expanded. */
	isOpen: boolean;
	/** Id shared by the trigger's `aria-controls` and the menu region. */
	menuId: string;
	/** Menu actions, cloned into `role="menuitem"` items. */
	children: ReactNode;
	onToggle: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	onMenuClick: (event: MouseEvent<HTMLDivElement>) => void;
	containerRef?: Ref<HTMLDivElement>;
	triggerRef?: Ref<HTMLButtonElement>;
	menuRef?: Ref<HTMLDivElement>;
}

/**
 * Every child becomes a menu item with a single managed tab stop, so the menu never relies on the
 * caller remembering the role and the item never grabs the page tab order while the menu is closed.
 */
function toMenuItems(children: ReactNode): ReactNode {
	return Children.map(children, (child) => {
		if (!isValidElement(child)) return child;
		return cloneElement(
			child as ReactElement<{ role?: string; tabIndex?: number }>,
			{ role: "menuitem", tabIndex: -1 },
		);
	});
}

export function AccountMenuView({
	identity,
	isOpen,
	menuId,
	children,
	onToggle,
	onKeyDown,
	onMenuClick,
	containerRef,
	triggerRef,
	menuRef,
}: AccountMenuViewProps) {
	return (
		<div className="react-account" ref={containerRef} onKeyDown={onKeyDown}>
			<button
				ref={triggerRef}
				type="button"
				className="react-account-trigger"
				aria-label="Abrir menú de cuenta"
				{...getAccountMenuTriggerAttributes(isOpen, menuId)}
				onClick={onToggle}
			>
				{identity.avatarSrc === null ? (
					<span
						className="react-account-avatar react-account-avatar-fallback"
						aria-hidden="true"
					>
						{identity.initials}
					</span>
				) : (
					<img
						className="react-account-avatar"
						src={identity.avatarSrc}
						alt=""
						referrerPolicy="no-referrer"
					/>
				)}
				<span className="react-account-trigger-text">
					<strong className="react-account-name">{identity.name}</strong>
					{identity.email !== "" && (
						<span className="react-account-email">{identity.email}</span>
					)}
				</span>
			</button>
			<div
				ref={menuRef}
				id={menuId}
				className="react-account-menu"
				role="menu"
				aria-label="Menú de cuenta"
				hidden={!isOpen}
				onClick={onMenuClick}
			>
				{toMenuItems(children)}
			</div>
		</div>
	);
}

export function AccountMenu({ profile, children, menuId = ACCOUNT_MENU_ID }: AccountMenuProps) {
	const [state, dispatch] = useReducer(reduceAccountMenu, createAccountMenuState());
	const isOpen = state.isOpen;
	const identity = useMemo(() => getAccountIdentity(profile), [profile]);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	const collectMenuItems = useCallback(
		() =>
			Array.from(
				menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
			),
		[],
	);

	// Opening moves focus into the menu, exactly like the legacy menu, so the first action is one
	// keystroke away instead of requiring a tab.
	useEffect(() => {
		if (!isOpen) return;
		const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
		firstItem?.focus();
	}, [isOpen]);

	// A pointer that lands outside the disclosure closes it. The listener is only attached while
	// open so a closed menu costs nothing.
	useEffect(() => {
		if (!isOpen) return;
		const handlePointerDown = (event: PointerEvent) => {
			const container = containerRef.current;
			if (container === null) return;
			if (event.target instanceof Node && container.contains(event.target)) return;
			dispatch({ type: "close" });
		};
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [isOpen]);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			if (!isOpen) return;
			event.preventDefault();
			dispatch({ type: "close" });
			// Escape is a dismissal, not a selection: focus returns to the trigger so the next
			// keystroke continues from where the menu was opened.
			triggerRef.current?.focus();
			return;
		}
		if (!isOpen) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				dispatch({ type: "open" });
			}
			return;
		}
		const direction = getMenuNavigationDirection(event.key);
		if (direction === null) return;
		const menuItems = collectMenuItems();
		if (menuItems.length === 0) return;
		event.preventDefault();
		const currentIndex = menuItems.indexOf(document.activeElement as HTMLElement);
		menuItems[getMenuItemNavigationIndex(currentIndex, menuItems.length, direction)]?.focus();
	};

	// Selecting an action closes the menu first; the action's own dialog then owns focus.
	const handleMenuClick = (event: MouseEvent<HTMLDivElement>) => {
		const target = event.target;
		if (!(target instanceof Element) || target.closest('[role="menuitem"]') === null) return;
		dispatch({ type: "close" });
		triggerRef.current?.focus();
	};

	return (
		<AccountMenuView
			identity={identity}
			isOpen={isOpen}
			menuId={menuId}
			onToggle={() => dispatch({ type: "toggle" })}
			onKeyDown={handleKeyDown}
			onMenuClick={handleMenuClick}
			containerRef={containerRef}
			triggerRef={triggerRef}
			menuRef={menuRef}
		>
			{children}
		</AccountMenuView>
	);
}
