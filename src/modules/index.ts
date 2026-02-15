/**
 * Module System
 * 
 * NestJS-inspired module system with dependency injection,
 * controllers, and provider management.
 */

import { Container, Token, type Provider, getInjectTokens } from '../container';
import { Router } from '../router';
import type { Context } from '../context';
import type { RouteHandler } from '../types';

// ============= Types =============

// Type alias for class constructors
type Constructor = new (...args: unknown[]) => unknown;

export interface ModuleMetadata {
  imports?: Constructor[];
  providers?: Provider[];
  controllers?: Constructor[];
  exports?: Token[];
}

export interface LifecycleHooks {
  onModuleInit?(): void | Promise<void>;
  onModuleDestroy?(): void | Promise<void>;
  onApplicationBootstrap?(): void | Promise<void>;
  onApplicationShutdown?(): void | Promise<void>;
}

// ============= Metadata Storage =============

// Simple metadata storage without Reflect.metadata
const metadataStore = new WeakMap<Constructor, Map<string, unknown>>();

function setMetadata(target: Constructor, key: string, value: unknown): void {
  if (!metadataStore.has(target)) {
    metadataStore.set(target, new Map());
  }
  metadataStore.get(target)!.set(key, value);
}

function getMetadata<T>(target: Constructor, key: string): T | undefined {
  return metadataStore.get(target)?.get(key) as T | undefined;
}

// Prototype metadata for method decorators
const prototypeMetadataStore = new WeakMap<object, Map<string, unknown>>();

function setPrototypeMetadata(target: object, key: string, value: unknown): void {
  if (!prototypeMetadataStore.has(target)) {
    prototypeMetadataStore.set(target, new Map());
  }
  prototypeMetadataStore.get(target)!.set(key, value);
}

function getPrototypeMetadata<T>(target: object, key: string): T | undefined {
  return prototypeMetadataStore.get(target)?.get(key) as T | undefined;
}

// ============= Decorators =============

/**
 * Mark a class as injectable
 */
export function Injectable(): ClassDecorator {
  return function (target: Constructor) {
    setMetadata(target, 'injectable', true);
    return target;
  };
}

/**
 * Mark a class as a controller with a base path
 */
export function Controller(path = ''): ClassDecorator {
  return function (target: Constructor) {
    setMetadata(target, 'controller', true);
    setMetadata(target, 'path', path);
    return target;
  };
}

/**
 * Define a module with metadata
 */
export function Module(metadata: ModuleMetadata): ClassDecorator {
  return function (target: Constructor) {
    setMetadata(target, 'module', metadata);
    return target;
  };
}

/**
 * Inject a dependency by token
 */
export function Inject(token: Token): ParameterDecorator {
  return function (
    target: unknown,
    propertyKey: string | symbol | undefined,
    parameterIndex: number
  ) {
    const targetObj = target as Constructor;
    const existingTokens: Token[] = getMetadata(targetObj, 'inject:tokens') ?? [];
    existingTokens[parameterIndex] = token;
    setMetadata(targetObj, 'inject:tokens', existingTokens);
  };
}

// ============= HTTP Method Decorators =============

function createMethodDecorator(method: string): (path?: string) => MethodDecorator {
  return (path = '') => {
    return function (
      target: unknown,
      propertyKey: string | symbol,
      descriptor: PropertyDescriptor
    ) {
      const targetObj = target as object;
      const routes = getPrototypeMetadata<Array<{ method: string; path: string; handler: string | symbol }>>(targetObj, 'routes') ?? [];
      routes.push({
        method,
        path,
        handler: propertyKey,
      });
      setPrototypeMetadata(targetObj, 'routes', routes);
      return descriptor;
    };
  };
}

export const Get = createMethodDecorator('GET');
export const Post = createMethodDecorator('POST');
export const Put = createMethodDecorator('PUT');
export const Patch = createMethodDecorator('PATCH');
export const Delete = createMethodDecorator('DELETE');
export const Head = createMethodDecorator('HEAD');
export const Options = createMethodDecorator('OPTIONS');

// ============= AppModule Class =============

export class AppModule {
  private moduleClass: Constructor;
  private metadata: ModuleMetadata;
  private providers: Provider[] = [];
  private controllers: Constructor[] = [];
  private visitedModules = new Set<Constructor>();

  constructor(moduleClass: Constructor) {
    this.moduleClass = moduleClass;
    this.metadata = getMetadata<ModuleMetadata>(moduleClass, 'module') ?? {};
    this.processModule(moduleClass);
  }

  /**
   * Process module and its imports recursively
   */
  private processModule(moduleClass: Constructor): void {
    if (this.visitedModules.has(moduleClass)) {
      return;
    }
    this.visitedModules.add(moduleClass);

    const metadata = getMetadata<ModuleMetadata>(moduleClass, 'module') ?? {};

    // Process imports first (so dependencies are available)
    if (metadata.imports) {
      for (const importedModule of metadata.imports) {
        this.processModule(importedModule);
      }
    }

    // Add providers
    if (metadata.providers) {
      this.providers.push(...metadata.providers);
    }

    // Add controllers
    if (metadata.controllers) {
      this.controllers.push(...metadata.controllers);
    }
  }

  /**
   * Get all collected providers
   */
  getProviders(): Provider[] {
    return [...this.providers];
  }

  /**
   * Get all collected controllers
   */
  getControllers(): Constructor[] {
    return [...this.controllers];
  }
}

// ============= Application Class =============

export class Application implements LifecycleHooks {
  container: Container;
  router: Router;
  private appModule: AppModule;

  constructor(moduleClass: Constructor) {
    this.container = new Container();
    this.router = new Router();
    this.appModule = new AppModule(moduleClass);
    this.registerProviders();
    this.registerControllers();
  }

  /**
   * Register all providers in the container
   */
  private registerProviders(): void {
    const providers = this.appModule.getProviders();
    this.container.registerAll(providers);
  }

  /**
   * Register all controllers and their routes
   */
  private registerControllers(): void {
    const controllers = this.appModule.getControllers();

    for (const controllerClass of controllers) {
      this.registerController(controllerClass);
    }
  }

  /**
   * Register a single controller and its routes
   */
  private registerController(controllerClass: Constructor): void {
    const basePath = getMetadata<string>(controllerClass, 'path') ?? '';
    const routes = getPrototypeMetadata<Array<{ method: string; path: string; handler: string | symbol }>>(controllerClass.prototype, 'routes') ?? [];

    // Create controller instance
    const injectTokens = getInjectTokens<Token[]>(controllerClass, 'inject:tokens') ?? [];
    const deps = injectTokens.map((token) => this.container.resolve(token));
    const instance = new controllerClass(...deps);

    // Register routes
    for (const route of routes) {
      const fullPath = basePath + route.path;
      const handler = (instance as Record<string | symbol, RouteHandler>)[route.handler];

      if (typeof handler === 'function') {
        const method = route.method.toLowerCase();
        const routerMethod = method as 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';
        
        if (routerMethod in this.router && typeof (this.router as unknown as Record<string, unknown>)[routerMethod] === 'function') {
          (this.router as unknown as Record<string, (p: string, h: RouteHandler) => void>)[routerMethod](
            fullPath,
            (context: Context) => handler.call(instance, context)
          );
        }
      }
    }
  }

  /**
   * Initialize the application
   */
  async init(): Promise<void> {
    // Try to call onModuleInit on module class if it has one
    const moduleClass = this.appModule.getProviders()[0]?.useClass;
    if (moduleClass) {
      try {
        const instance = new (moduleClass as Constructor)() as LifecycleHooks;
        await instance.onModuleInit?.();
      } catch {
        // Ignore if no lifecycle hooks
      }
    }
  }

  /**
   * Start the HTTP server
   */
  async listen(port = 3000, hostname = 'localhost'): Promise<void> {
    const { Context } = await import('../context');
    const { compose } = await import('../middleware');
    
    Bun.serve({
      port,
      hostname,
      fetch: async (request: Request) => {
        const url = new URL(request.url);
        const match = this.router.match(request.method as 'GET', url.pathname);

        if (!match) {
          return new Response('Not Found', { status: 404 });
        }

        // Create context
        const context = new Context(request, match.params);

        // Execute middleware and handler
        const pipeline = compose(match.middleware ?? []);
        
        return pipeline(context, match.handler);
      },
    });

    console.log(`Server running at http://${hostname}:${port}`);
  }

  /**
   * Handle request directly (for testing)
   */
  async handle(request: Request): Promise<Response> {
    const { Context } = await import('../context');
    const { compose } = await import('../middleware');
    
    const url = new URL(request.url);
    const match = this.router.match(request.method as 'GET', url.pathname);

    if (!match) {
      return new Response('Not Found', { status: 404 });
    }

    const context = new Context(request, match.params);
    const pipeline = compose(match.middleware ?? []);
    
    return pipeline(context, match.handler);
  }
}

/**
 * Create an application from a module
 */
export function createApp(moduleClass: Constructor): Application {
  return new Application(moduleClass);
}
