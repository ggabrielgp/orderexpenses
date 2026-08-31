export function bindNativeAccountMenu({
	trigger,
	menu,
	firstMenuItem,
	documentRoot = document,
	bindClick = true,
}) {
	function close() {
		if (menu.hidden) return;
		menu.hidden = true;
		trigger.setAttribute("aria-expanded", "false");
	}

	function toggle() {
		if (trigger.hidden) return;
		const open = menu.hidden;
		menu.hidden = !open;
		trigger.setAttribute("aria-expanded", String(open));
		if (open) firstMenuItem.focus();
	}

	if (bindClick) trigger.addEventListener("click", toggle);
	trigger.addEventListener("keydown", (event) => {
		if (event.key === "Escape") close();
	});
	documentRoot.addEventListener("click", (event) => {
		if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target))
			close();
	});
	documentRoot.addEventListener("keydown", (event) => {
		if (event.key === "Escape") close();
	});

	return { close, toggle };
}
