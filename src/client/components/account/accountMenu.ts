import type { SessionProfile } from "../../api/types";

/** Stable id for the authenticated account menu; the trigger always references it. */
export const ACCOUNT_MENU_ID = "react-account-menu";

/**
 * What the trigger renders for the signed-in profile.
 *
 * `avatarSrc` is only ever the picture the session actually reported: the module never invents a
 * URL or requests a default asset, so a profile without a picture falls back to derived initials
 * that are pure text.
 */
export interface AccountIdentity {
	name: string;
	email: string;
	avatarSrc: string | null;
	initials: string;
}

/**
 * The menu trigger's ARIA disclosure attributes.
 *
 * `aria-controls` is always present because the legacy menu keeps its element mounted (hidden while
 * closed) and the trigger must name the region it controls in both states. `aria-expanded` is a
 * boolean so React serializes it as the string the attribute expects.
 */
export interface AccountMenuTriggerAttributes {
	"aria-haspopup": "menu";
	"aria-expanded": boolean;
	"aria-controls": string;
}

export interface AccountMenuState {
	isOpen: boolean;
}

export type AccountMenuEvent =
	| { type: "open" }
	| { type: "close" }
	| { type: "toggle" };

export type MenuNavigationDirection = "next" | "previous" | "first" | "last";

function normalizeText(value: string | null | undefined): string {
	return typeof value === "string" ? value.trim() : "";
}

function deriveInitials(name: string, email: string): string {
	const source = name.trim() || email.trim();
	if (source === "") return "U";
	const words = source.split(/\s+/).filter((word) => word.length > 0);
	if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
	return words[0].slice(0, 1).toUpperCase();
}

/**
 * Resolves the display identity for the account menu.
 *
 * Every decision is deliberate: the name falls back to a neutral Spanish label, the initials fall
 * back to the email and then to a single letter, and a blank or non-string picture is treated as
 * absent instead of as a URL to load.
 */
export function getAccountIdentity(profile: SessionProfile | null): AccountIdentity {
	const rawName = normalizeText(profile?.name);
	const email = normalizeText(profile?.email);
	const picture = normalizeText(profile?.picture);
	return {
		name: rawName === "" ? "Usuario" : rawName,
		email,
		avatarSrc: picture === "" ? null : picture,
		initials: deriveInitials(rawName, email),
	};
}

export function createAccountMenuState(): AccountMenuState {
	return { isOpen: false };
}

/**
 * The only transitions the menu needs. `toggle` is separate from `open`/`close` because the
 * trigger click does not know the previous state, and keeping it here means the component never
 * re-reads `isOpen` to build the next state by hand.
 */
export function reduceAccountMenu(
	state: AccountMenuState,
	event: AccountMenuEvent,
): AccountMenuState {
	switch (event.type) {
		case "open":
			return { isOpen: true };
		case "close":
			return { isOpen: false };
		case "toggle":
			return { isOpen: !state.isOpen };
	}
}

export function getAccountMenuTriggerAttributes(
	isOpen: boolean,
	menuId: string,
): AccountMenuTriggerAttributes {
	return {
		"aria-haspopup": "menu",
		"aria-expanded": isOpen,
		"aria-controls": menuId,
	};
}

export function getMenuNavigationDirection(key: string): MenuNavigationDirection | null {
	switch (key) {
		case "ArrowDown":
			return "next";
		case "ArrowUp":
			return "previous";
		case "Home":
			return "first";
		case "End":
			return "last";
		default:
			return null;
	}
}

/**
 * The index the next focus should land on, given where focus currently is.
 *
 * A negative `currentIndex` means focus is not on a menu item yet (typically the trigger), so
 * stepping forward opens at the first item and stepping backward wraps to the last one. `next`
 * wraps forward and `previous` wraps backward, which is the menu pattern keyboard users expect.
 */
export function getMenuItemNavigationIndex(
	currentIndex: number,
	itemCount: number,
	direction: MenuNavigationDirection,
): number {
	if (itemCount <= 0) return -1;
	switch (direction) {
		case "first":
			return 0;
		case "last":
			return itemCount - 1;
		case "next":
			return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
		case "previous":
			return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1;
	}
}
