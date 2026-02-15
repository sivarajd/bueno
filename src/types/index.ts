/**
 * Core type definitions for Bueno Framework
 */

// ============= HTTP Types =============

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type StatusCode = 
  | 200 | 201 | 202 | 204
  | 301 | 302 | 303 | 307 | 308
  | 400 | 401 | 403 | 404 | 405 | 409 | 422 | 429
  | 500 | 502 | 503 | 504;

// ============= Route Types =============

export type PathParams = Record<string, string>;

export interface RouteHandler<T = unknown> {
  (context: unknown): T | Promise<T>;
}

export type RoutePath = string;

export interface RouteDefinition {
  method: HTTPMethod;
  path: RoutePath;
  handler: RouteHandler;
  middleware?: MiddlewareHandler[];
}

// ============= Middleware Types =============

export type MiddlewareHandler<T = unknown> = (
  context: unknown,
  next: () => Promise<unknown>
) => T | Promise<T>;

export type MiddlewareChain = MiddlewareHandler[];

// ============= DI Types =============

export type Token<T = unknown> = string | symbol | abstract new (...args: unknown[]) => T;

export interface Provider<T = unknown> {
  token: Token<T>;
  useClass?: abstract new (...args: unknown[]) => T;
  useValue?: T;
  useFactory?: (...args: unknown[]) => T | Promise<T>;
  inject?: Token[];
  scope?: 'singleton' | 'transient' | 'request';
}

export interface ModuleMetadata {
  imports?: Token[];
  providers?: Provider[];
  controllers?: Token[];
  exports?: Token[];
}

// ============= Context Types =============

export interface ContextVariableMap {
  [key: string]: unknown;
}

export interface ContextDefaults {
  status: StatusCode;
  headers: Headers;
}

// ============= Validation Types =============

export interface StandardSchema<T = unknown> {
  readonly '~standard': {
    validate: (value: unknown) => StandardResult<T>;
    types?: {
      input: unknown;
      output: T;
    };
  };
}

export type StandardResult<T> = 
  | { value: T }
  | { issues: StandardIssue[] };

export interface StandardIssue {
  message: string;
  path?: (string | number | symbol)[];
}

export type ValidationTarget = 'body' | 'query' | 'params' | 'headers' | 'cookies';

// ============= Database Types =============

export type DatabaseDriver = 'postgresql' | 'mysql' | 'sqlite';

export interface DatabaseConfig {
  url: string;
  pool?: {
    min?: number;
    max?: number;
  };
}

// ============= Server Types =============

export interface ServerConfig {
  port?: number;
  hostname?: string;
  development?: {
    hmr?: boolean;
    console?: boolean;
  };
}

export interface AppOptions {
  server?: ServerConfig;
  database?: DatabaseConfig;
}

// ============= RPC Types =============

export interface RPCClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

// ============= Error Types =============

export class BuenoError extends Error {
  constructor(
    message: string,
    public statusCode: StatusCode = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'BuenoError';
  }
}

export class ValidationError extends BuenoError {
  constructor(
    message: string,
    public issues: StandardIssue[]
  ) {
    super(message, 422, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends BuenoError {
  constructor(message = 'Not Found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}
