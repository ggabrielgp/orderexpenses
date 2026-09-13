export function LandingFooter() {
	return (
		<footer className="landing-footer">
			<div className="landing-shell landing-footer-content">
				<div className="landing-footer-brand">
					<a href="/">
						<span className="material-symbols-outlined landing-footer-brand-icon" aria-hidden="true">account_balance_wallet</span>
						Gastos Controlados
					</a>
					<span>© 2026 Gastos Controlados</span>
				</div>
				<nav className="landing-footer-nav" aria-label="Navegación del pie">
					<a href="#producto">Producto</a>
					<a href="#como-funciona">Cómo funciona</a>
					<a href="#seguridad">Seguridad</a>
					<a href="/app">Dashboard</a>
				</nav>
			</div>
		</footer>
	);
}
