import { EventEmitter } from "node:events";

const operations = ["exchange", "profile", "list", "get"];
let configured = {};
export const googleCalls = Object.fromEntries(operations.map((name) => [name, []]));

// Results use the Google response shape ({ tokens } or { data }); callbacks can inspect
// arguments or model pagination. Errors model upstream failures without touching a network.
export function configureGoogleFixtures(fixtures = {}) {
	configured = { ...fixtures };
	for (const calls of Object.values(googleCalls)) calls.length = 0;
}
export function resetGoogleFixtures() {
	configureGoogleFixtures();
}
async function invoke(name, args) {
	googleCalls[name].push(args);
	if (!Object.hasOwn(configured, name)) {
		throw new Error(`Unconfigured fixture: Google ${name}`);
	}
	const result = configured[name];
	if (result instanceof Error) throw result;
	return typeof result === "function" ? result(args) : structuredClone(result);
}
class OAuth2 extends EventEmitter {
	constructor(clientId, clientSecret, redirectUri) {
		super();
		this.clientId = clientId;
		this.redirectUri = redirectUri;
		this.credentials = {};
	}
	setCredentials(tokens) {
		this.credentials = { ...tokens };
	}
	generateAuthUrl(options) {
		const url = new URL("https://google.fixture.invalid/authorize");
		url.searchParams.set("client_id", this.clientId ?? "test-client-id");
		url.searchParams.set("redirect_uri", this.redirectUri ?? "http://localhost:3000/auth/google/callback");
		url.searchParams.set("state", options.state);
		return url.href;
	}
	getToken(code) {
		return invoke("exchange", code);
	}
}
export const google = {
	auth: { OAuth2 },
	oauth2: () => ({ userinfo: { get: (args) => invoke("profile", args) } }),
	gmail: () => ({ users: { messages: {
		list: (args) => invoke("list", args),
		get: (args) => invoke("get", args),
	} } }),
};
