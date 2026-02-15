/**
 * RPC Client
 * 
 * Type-safe HTTP client for making requests to Bueno servers.
 * Provides method inference and automatic serialization.
 */

import type { Router } from '../router';

// ============= Types =============

export interface RPCClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
  interceptors?: {
    request?: (config: RequestInit) => RequestInit;
    response?: (response: Response) => Response | Promise<Response>;
  };
}

export interface RequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  timeout?: number;
}

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

// ============= RPC Client =============

export class RPCClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private defaultTimeout: number;
  private interceptors?: RPCClientOptions['interceptors'];

  constructor(options: RPCClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.defaultTimeout = options.timeout ?? 30000;
    this.interceptors = options.interceptors;
  }

  /**
   * Make a GET request
   */
  async get(path: string, options?: RequestOptions): Promise<Response> {
    return this.request('GET', path, undefined, options);
  }

  /**
   * Make a POST request
   */
  async post<T = unknown>(path: string, body?: T, options?: RequestOptions): Promise<Response> {
    return this.request('POST', path, body, options);
  }

  /**
   * Make a PUT request
   */
  async put<T = unknown>(path: string, body?: T, options?: RequestOptions): Promise<Response> {
    return this.request('PUT', path, body, options);
  }

  /**
   * Make a PATCH request
   */
  async patch<T = unknown>(path: string, body?: T, options?: RequestOptions): Promise<Response> {
    return this.request('PATCH', path, body, options);
  }

  /**
   * Make a DELETE request
   */
  async delete(path: string, options?: RequestOptions): Promise<Response> {
    return this.request('DELETE', path, undefined, options);
  }

  /**
   * Make a HEAD request
   */
  async head(path: string, options?: RequestOptions): Promise<Response> {
    return this.request('HEAD', path, undefined, options);
  }

  /**
   * Make an OPTIONS request
   */
  async options(path: string, options?: RequestOptions): Promise<Response> {
    return this.request('OPTIONS', path, undefined, options);
  }

  /**
   * Make a generic request
   */
  private async request<T>(
    method: HTTPMethod,
    path: string,
    body?: T,
    options?: RequestOptions
  ): Promise<Response> {
    // Build URL with query params
    let url = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    
    if (options?.query) {
      const searchParams = new URLSearchParams(options.query);
      url += `?${searchParams.toString()}`;
    }

    // Build request config
    let config: RequestInit = {
      method,
      headers: {
        ...this.defaultHeaders,
        ...options?.headers,
      },
    };

    // Add body for non-GET requests
    if (body && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      config.body = JSON.stringify(body);
    }

    // Apply request interceptor
    if (this.interceptors?.request) {
      config = this.interceptors.request(config);
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = options?.timeout ?? this.defaultTimeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    config.signal = controller.signal;

    try {
      const response = await fetch(url, config);
      
      // Apply response interceptor
      if (this.interceptors?.response) {
        return this.interceptors.response(response);
      }
      
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Create a new client with different base URL
   */
  withBaseUrl(baseUrl: string): RPCClient {
    return new RPCClient({
      baseUrl,
      headers: this.defaultHeaders,
      timeout: this.defaultTimeout,
      interceptors: this.interceptors,
    });
  }

  /**
   * Create a new client with additional headers
   */
  withHeaders(headers: Record<string, string>): RPCClient {
    return new RPCClient({
      baseUrl: this.baseUrl,
      headers: { ...this.defaultHeaders, ...headers },
      timeout: this.defaultTimeout,
      interceptors: this.interceptors,
    });
  }
}

// ============= Client Factory =============

/**
 * Create an RPC client
 */
export function createRPClient(options: RPCClientOptions): RPCClient {
  return new RPCClient(options);
}

/**
 * Type-safe client factory for route types
 * Usage: const client = bc<typeof app>(baseUrl)
 */
export function bc<T>(options: RPCClientOptions): RPCClient {
  return createRPClient(options);
}

// ============= Route Type Extraction =============

export interface RouteTypeInfo {
  method: HTTPMethod;
  path: string;
}

/**
 * Extract route type information from a router
 */
export function extractRouteTypes(router: Router): RouteTypeInfo[] {
  const routes = router.getRoutes();
  return routes.map(r => ({
    method: r.method as HTTPMethod,
    path: r.pattern,
  }));
}

// ============= Response Helpers =============

/**
 * Parse JSON response
 */
export async function parseJSON<T>(response: Response): Promise<T> {
  return response.json();
}

/**
 * Parse text response
 */
export async function parseText(response: Response): Promise<string> {
  return response.text();
}

/**
 * Check if response is OK (status 200-299)
 */
export function isOK(response: Response): boolean {
  return response.ok;
}

/**
 * Check if response is a specific status code
 */
export function isStatus(response: Response, status: number): boolean {
  return response.status === status;
}

/**
 * Throw if response is not OK
 */
export async function throwIfNotOK(response: Response): Promise<Response> {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }
  return response;
}
