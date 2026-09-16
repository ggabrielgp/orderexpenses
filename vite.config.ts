import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget = "http://127.0.0.1:3000";

function backendProxy() {
	return {
		target: backendTarget,
		changeOrigin: true,
		headers: { origin: backendTarget },
	};
}

function demoAppProxy(requestUrl?: string) {
	const url = new URL(requestUrl ?? "/app", backendTarget);
	if (url.pathname === "/app/demo" || url.pathname === "/app/demo/") return "/app";
	if (url.searchParams.has("demo")) return undefined;
	return url.pathname === "/app" || url.pathname === "/app/" ? "/app" : undefined;
}

export default defineConfig({
	plugins: [react()],
	server: {
		proxy: {
			"/api": backendProxy(),
			"/auth": backendProxy(),
			"^/app(?:/|\\?|$)": {
				...backendProxy(),
				bypass: (request) => demoAppProxy(request.url),
			},
			"/legacy-app": backendProxy(),
		},
	},
});
