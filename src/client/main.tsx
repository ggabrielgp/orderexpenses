import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./design-tokens.css";
import "./app.css";
import "./styles.css";
import "./dashboard-motion.css";
import "./dashboard-loading.css";
import "./dashboard-polish.css";
import "./dialog-polish.css";
import "./dashboard-mobile-ergonomics.css";
import "./dashboard-mobile-content.css";
// Identity B loads last so its accent remap and new surfaces win over the legacy layers.
import "./identity-b.css";
// Phase 2 motion loads after everything so the bottom-sheet geometry wins over legacy dialog widths.
import "./motion.css";
import "./demo-scenarios.css";
// Dark mode loads last so [data-theme="dark"] overrides both legacy and Identity B layers.
import "./dark-mode.css";

const rootElement = document.querySelector<HTMLDivElement>("#root");
if (!rootElement) throw new Error("React root element is missing");

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
