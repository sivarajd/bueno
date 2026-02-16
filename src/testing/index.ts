/**
 * Testing Utilities
 *
 * Helper functions for testing Bueno applications with bun:test.
 * Provides request/response testing utilities, mocking, and fixtures.
 */

import { Context } from "../context";
import type { Middleware } from "../middleware";
import type { Router } from "../router";

// ============= Types =============

export interface TestRequestOptions {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
	headers?: Record<string, string>;
	query?: Record<string, string>;
	body?: unknown;
	cookies?: Record<string, string>;
}

export interface TestResponse {
	status: number;
	headers: Headers;
	body: unknown;
	text: string;
	json: () => Promise<unknown>;
}

export interface TestContext {
	request: Request;
	response: Response | null;
	context: Context | null;
}

// ============= Test Request Builder =============

/**
 * Create a test request
 */
export function createTestRequest(
	path: string,
	options: TestRequestOptions = {},
): Request {
	const {
		method = "GET",
		headers = {},
		query = {},
		body,
		cookies = {},
	} = options;

	// Build URL with query params
	const url = new URL(`http://localhost${path}`);
	for (const [key, value] of Object.entries(query)) {
		url.searchParams.set(key, value);
	}

	// Build headers
	const requestHeaders = new Headers(headers);

	// Add cookies
	if (Object.keys(cookies).length > 0) {
		const cookieString = Object.entries(cookies)
			.map(([k, v]) => `${k}=${v}`)
			.join("; ");
		requestHeaders.set("Cookie", cookieString);
	}

	// Build body
	let requestBody:
		| string
		| ArrayBuffer
		| FormData
		| URLSearchParams
		| undefined;
	if (body !== undefined) {
		if (typeof body === "string") {
			requestBody = body;
			if (!requestHeaders.has("Content-Type")) {
				requestHeaders.set("Content-Type", "text/plain");
			}
		} else if (body instanceof FormData) {
			requestBody = body;
		} else if (body instanceof URLSearchParams) {
			requestBody = body;
			if (!requestHeaders.has("Content-Type")) {
				requestHeaders.set("Content-Type", "application/x-www-form-urlencoded");
			}
		} else {
			requestBody = JSON.stringify(body);
			if (!requestHeaders.has("Content-Type")) {
				requestHeaders.set("Content-Type", "application/json");
			}
		}
	}

	return new Request(url.toString(), {
		method,
		headers: requestHeaders,
		body: requestBody,
	});
}

// ============= Test Response Helpers =============

/**
 * Create a test response wrapper
 */
export async function createTestResponse(
	response: Response,
): Promise<TestResponse> {
	const clone = response.clone();
	let body: unknown = null;

	try {
		const contentType = response.headers.get("Content-Type") || "";
		if (contentType.includes("application/json")) {
			body = await response.json();
		} else {
			body = await response.text();
		}
	} catch {
		body = null;
	}

	return {
		status: response.status,
		headers: response.headers,
		body,
		text: await clone.text(),
		json: async () => response.json(),
	};
}

// ============= App Tester =============

export class AppTester {
	private router: Router;

	constructor(router: Router) {
		this.router = router;
	}

	/**
	 * Make a test request to the app
	 */
	async request(
		path: string,
		options?: TestRequestOptions,
	): Promise<TestResponse> {
		const request = createTestRequest(path, options);
		const url = new URL(request.url);

		const match = this.router.match(request.method as "GET", url.pathname);

		if (!match) {
			return createTestResponse(new Response("Not Found", { status: 404 }));
		}

		const context = new Context(request, match.params);

		// Handle middleware
		if (match.middleware && match.middleware.length > 0) {
			const { compose } = await import("../middleware");
			const pipeline = compose(match.middleware as Middleware[]);
			const response = await pipeline(
				context,
				async () => match.handler(context) as Response,
			);
			return createTestResponse(response);
		}

		const response = await match.handler(context);
		return createTestResponse(response as Response);
	}

	/**
	 * GET request helper
	 */
	async get(
		path: string,
		options?: Omit<TestRequestOptions, "method" | "body">,
	): Promise<TestResponse> {
		return this.request(path, { ...options, method: "GET" });
	}

	/**
	 * POST request helper
	 */
	async post(
		path: string,
		body?: unknown,
		options?: Omit<TestRequestOptions, "method" | "body">,
	): Promise<TestResponse> {
		return this.request(path, { ...options, method: "POST", body });
	}

	/**
	 * PUT request helper
	 */
	async put(
		path: string,
		body?: unknown,
		options?: Omit<TestRequestOptions, "method" | "body">,
	): Promise<TestResponse> {
		return this.request(path, { ...options, method: "PUT", body });
	}

	/**
	 * PATCH request helper
	 */
	async patch(
		path: string,
		body?: unknown,
		options?: Omit<TestRequestOptions, "method" | "body">,
	): Promise<TestResponse> {
		return this.request(path, { ...options, method: "PATCH", body });
	}

	/**
	 * DELETE request helper
	 */
	async delete(
		path: string,
		options?: Omit<TestRequestOptions, "method">,
	): Promise<TestResponse> {
		return this.request(path, { ...options, method: "DELETE" });
	}
}

/**
 * Create an app tester
 */
export function createTester(router: Router): AppTester {
	return new AppTester(router);
}

// ============= Mock Helpers =============

/**
 * Create a mock context for testing handlers directly
 */
export function createMockContext(
	path: string,
	options: TestRequestOptions = {},
): Context {
	const request = createTestRequest(path, options);
	return new Context(request, {});
}

/**
 * Create a mock context with params
 */
export function createMockContextWithParams(
	path: string,
	params: Record<string, string>,
	options: TestRequestOptions = {},
): Context {
	const request = createTestRequest(path, options);
	return new Context(request, params);
}

// ============= Assertion Helpers =============

/**
 * Assert response status
 */
export function assertStatus(response: TestResponse, expected: number): void {
	if (response.status !== expected) {
		throw new Error(`Expected status ${expected}, got ${response.status}`);
	}
}

/**
 * Assert response is OK (2xx)
 */
export function assertOK(response: TestResponse): void {
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Expected OK status, got ${response.status}`);
	}
}

/**
 * Assert response is JSON
 */
export function assertJSON(response: TestResponse): void {
	const contentType = response.headers.get("Content-Type");
	if (!contentType?.includes("application/json")) {
		throw new Error(`Expected JSON response, got ${contentType}`);
	}
}

/**
 * Assert response body
 */
export function assertBody(response: TestResponse, expected: unknown): void {
	if (JSON.stringify(response.body) !== JSON.stringify(expected)) {
		throw new Error(
			`Expected body ${JSON.stringify(expected)}, got ${JSON.stringify(response.body)}`,
		);
	}
}

/**
 * Assert response has header
 */
export function assertHeader(
	response: TestResponse,
	name: string,
	value?: string,
): void {
	const headerValue = response.headers.get(name);
	if (!headerValue) {
		throw new Error(`Expected header ${name} to be present`);
	}
	if (value && headerValue !== value) {
		throw new Error(
			`Expected header ${name} to be ${value}, got ${headerValue}`,
		);
	}
}

/**
 * Assert redirect
 */
export function assertRedirect(
	response: TestResponse,
	location?: string,
): void {
	if (response.status < 300 || response.status >= 400) {
		throw new Error(`Expected redirect status, got ${response.status}`);
	}
	if (location) {
		assertHeader(response, "Location", location);
	}
}

// ============= Snapshot Helpers =============

/**
 * Create a snapshot of response for testing
 */
export function snapshotResponse(response: TestResponse): object {
	return {
		status: response.status,
		headers: Object.fromEntries(response.headers.entries()),
		body: response.body,
	};
}

// ============= Fixture Factory =============

/**
 * Create a test fixture factory
 */
export class FixtureFactory {
	private sequences: Map<string, number> = new Map();

	/**
	 * Generate a unique ID
	 */
	id(prefix = "test"): string {
		const seq = (this.sequences.get(prefix) ?? 0) + 1;
		this.sequences.set(prefix, seq);
		return `${prefix}_${seq}`;
	}

	/**
	 * Generate a unique email
	 */
	email(domain = "test.com"): string {
		return `${this.id("email")}@${domain}`;
	}

	/**
	 * Generate a unique UUID
	 */
	uuid(): string {
		return crypto.randomUUID();
	}

	/**
	 * Reset all sequences
	 */
	reset(): void {
		this.sequences.clear();
	}
}

export function createFixtureFactory(): FixtureFactory {
	return new FixtureFactory();
}

// ============= Wait/Timeout Helpers =============

/**
 * Wait for a condition to be true
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeout = 5000,
	interval = 50,
): Promise<void> {
	const start = Date.now();

	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	throw new Error("Timeout waiting for condition");
}

/**
 * Sleep for a duration
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
