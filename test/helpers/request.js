// Handler-level requests need no listening socket. Chunks model Node's async request
// iterator, including split JSON bodies, while cookies/headers stay caller-controlled.
export function createRequest(pathname, {
	method = "GET", headers = {}, cookies = {}, sessionId, body, chunks,
} = {}) {
	const requestHeaders = { host: "localhost:3000" };
	for (const [name, value] of Object.entries(headers)) requestHeaders[name.toLowerCase()] = value;
	const cookieValues = { ...cookies };
	if (sessionId) cookieValues.finance_session = sessionId;
	if (Object.keys(cookieValues).length) {
		requestHeaders.cookie = Object.entries(cookieValues).map(([name, value]) => `${name}=${value}`).join("; ");
	}
	const bodyChunks = chunks ?? (body === undefined ? [] : [typeof body === "string" ? body : JSON.stringify(body)]);
	return {
		url: pathname,
		method,
		headers: requestHeaders,
		async *[Symbol.asyncIterator]() {
			for await (const chunk of bodyChunks) yield Buffer.from(chunk);
		},
	};
}
export function request(handler, pathname, options) {
	return new Promise((resolve, reject) => {
		const response = {
			status: 200,
			headers: {},
			setHeader(name, value) {
				this.headers[name.toLowerCase()] = value;
			},
			writeHead(status, headers = {}) {
				this.status = status;
				for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
			},
			end(body = "") {
				resolve({ status: this.status, headers: this.headers, body: String(body) });
			},
		};
		Promise.resolve().then(() => handler(createRequest(pathname, options), response)).catch(reject);
	});
}
