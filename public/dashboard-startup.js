export function createDeferredDashboardInitializer({
	loadGmailStatus,
	loadCategories,
	loadTransactions,
	autoSyncAfterGmailConnect,
}) {
	let initialization;
	return () => {
		if (!initialization) {
			initialization = (async () => {
				await loadGmailStatus();
				await loadCategories();
				await loadTransactions();
				await autoSyncAfterGmailConnect();
			})();
		}
		return initialization;
	};
}
