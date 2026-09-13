import { DashboardRoute } from "./hooks/DashboardRoute";
import { LandingPage } from "./pages/LandingPage";

export default function App() {
	return window.location.pathname === "/" ? <LandingPage /> : <DashboardRoute />;
}
