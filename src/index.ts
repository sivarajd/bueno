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
  ReservedConnection,
  type DatabaseConfig,
  type DatabaseDriver,
  type QueryResult,
  type Transaction,
  // Schema
  SchemaBuilder,
  createSchema,
  defineTable,
  generateCreateTable,
  generateDropTable,
  generateCreateIndex,
  type ColumnType,
  type ColumnOptions,
  type TableSchema,
  type IndexDefinition,
  type ConstraintDefinition,
  type TypeScriptType,
  type InferType,
  type InferInsertType,
  // Migrations
  MigrationRunner,
  MigrationBuilder,
  createMigration,
  createMigrationRunner,
  generateMigrationId,
  type Migration,
  type MigrationRecord,
  type MigrationOptions,
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

// SSG
export {
  SSG,
  createSSG,
  parseMarkdown,
  parseFrontmatter,
  type Frontmatter,
  type Page,
  type SSGConfig,
  type LayoutContext,
  type SiteConfig,
} from './ssg';

// Storage
export {
  Storage,
  createStorage,
  Secrets,
  type StorageConfig,
  type UploadOptions,
  type DownloadOptions,
  type FileInfo,
  type ListOptions,
  type ListResult,
  type PresignedURLOptions,
  type SecretOptions,
  type SetSecretOptions,
} from './storage';

// Testing
export {
  AppTester,
  createTester,
  createTestRequest,
  createTestResponse,
  createMockContext,
  createMockContextWithParams,
  assertStatus,
  assertOK,
  assertJSON,
  assertBody,
  assertHeader,
  assertRedirect,
  snapshotResponse,
  FixtureFactory,
  createFixtureFactory,
  waitFor,
  sleep,
  type TestRequestOptions,
  type TestResponse,
} from './testing';

// WebSocket
export {
  WebSocketServer,
  WebSocketClient,
  PubSub,
  createWebSocketServer,
  createWebSocketClient,
  createPubSub,
  isWebSocketRequest,
  generateConnectionId,
  createWebSocketData,
  type WebSocketData,
  type WebSocketMessage,
  type WebSocketOptions,
  type WebSocketHandler,
  type OpenHandler,
  type CloseHandler,
  type ErrorHandler,
  type WebSocketServerOptions,
  type WebSocketClientOptions,
} from './websocket';

// Logger
export {
  Logger,
  PerformanceLogger,
  createLogger,
  createRequestLogger,
  getLogger,
  setLogger,
  type LogLevel,
  type LogEntry,
  type LoggerConfig,
  type LoggerContext,
} from './logger';

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
  ServerConfig,
  AppOptions,
  BuenoError,
  ValidationError,
  NotFoundError,
} from './types';

// Quick Start Helper
import { Router } from './router';
import { Context } from './context';
import { compose, type Middleware } from './middleware';

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
        fetch: async (request: Request): Promise<Response> => {
          const url = new URL(request.url);
          const match = router.match(request.method as 'GET', url.pathname);
          
          if (!match) {
            return new Response('Not Found', { status: 404 });
          }
          
          const context = new Context(request, match.params);
          
          if (match.middleware && match.middleware.length > 0) {
            const pipeline = compose(match.middleware as Middleware[]);
            return pipeline(context, async () => match.handler(context) as Response);
          }
          
          return match.handler(context) as Response;
        },
      });
      
      console.log(`Bueno server running at http://${hostname}:${port}`);
      return server;
    },
  };
}
