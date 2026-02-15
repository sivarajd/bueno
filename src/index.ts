/**
 * Bueno Framework
 * 
 * A Bun-Native Full-Stack Framework
 */

// Version
export const VERSION = '0.1.0';

// Core
export { Container, Token, Injectable, Inject, type Provider } from './container';
export { Router, generateUrl } from './router';
export { Context, createContext } from './context';
export { compose, createPipeline, type Middleware, type Handler } from './middleware';

// Built-in Middleware
export {
  logger,
  cors,
  requestId,
  timing,
  securityHeaders,
  rateLimit,
  compression,
} from './middleware/built-in';

// Modules
export {
  Module,
  Controller,
  Injectable as ModuleInjectable,
  Inject as ModuleInject,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Head,
  Options,
  AppModule,
  Application,
  createApp,
} from './modules';

// Database
export {
  Database,
  createConnection,
  detectDriver,
  QueryBuilder,
  table,
} from './database';

// Validation
export {
  z,
  validate,
  validateBody,
  validateQuery,
  validateParams,
  validateHeaders,
  createValidator,
  WithBody,
  WithQuery,
  schemas,
  paginationSchema,
  type ValidationResult,
} from './validation';

// Security
export {
  Password,
  JWT,
  CSRF,
  createAuthMiddleware,
  createRBACMiddleware,
  createAPIKeyMiddleware,
} from './security';

// RPC
export {
  RPCClient,
  createRPClient,
  bc,
  extractRouteTypes,
  parseJSON,
  parseText,
  isOK,
  isStatus,
  throwIfNotOK,
} from './rpc';

// Cache
export {
  Cache,
  SessionStore,
  createCache,
  createSessionStore,
} from './cache';

// Types
export type {
  HTTPMethod,
  StatusCode,
  PathParams,
  RouteHandler,
  MiddlewareHandler,
  RouteDefinition,
  Token as TokenType,
  ModuleMetadata,
  ContextVariableMap,
  StandardSchema,
  StandardIssue,
  DatabaseDriver,
  DatabaseConfig,
  ServerConfig,
  AppOptions,
  BuenoError,
  ValidationError,
  NotFoundError,
} from './types';

// Quick Start Helper
export function createServer(options?: {
  port?: number;
  hostname?: string;
}) {
  const router = new Router();
  
  return {
    router,
    async listen(port = options?.port ?? 3000, hostname = options?.hostname ?? 'localhost') {
      const server = Bun.serve({
        port,
        hostname,
        fetch: async (request: Request) => {
          const url = new URL(request.url);
          const match = router.match(request.method as 'GET', url.pathname);
          
          if (!match) {
            return new Response('Not Found', { status: 404 });
          }
          
          const context = new Context(request, match.params);
          
          if (match.middleware && match.middleware.length > 0) {
            const pipeline = compose(match.middleware);
            return pipeline(context, match.handler);
          }
          
          return match.handler(context);
        },
      });
      
      console.log(`Bueno server running at http://${hostname}:${port}`);
      return server;
    },
  };
}
