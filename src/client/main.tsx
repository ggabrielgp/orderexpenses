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

const rootElement = document.querySelector<HTMLDivElement>("#root");
if (!rootElement) throw new Error("React root element is missing");

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
