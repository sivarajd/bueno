/**
 * Dependency Injection Container
 * 
 * Provides inversion of control for managing dependencies
 * with support for constructor injection, factories, and scopes.
 */

import type { Provider } from '../types';

// ============= Token =============

/**
 * Creates a typed injection token
 */
export function Token<T>(description: string): Token<T> {
  return Symbol(description) as Token<T>;
}

export type Token<T = unknown> = symbol & { readonly __type?: T };

// ============= Provider Resolution =============

interface ResolvedProvider<T = unknown> {
  provider: Provider<T>;
  instance?: T;
}

// ============= Circular Dependency Detection =============

class ResolutionStack {
  private stack = new Set<Token>();

  push(token: Token): void {
    if (this.stack.has(token)) {
      throw new Error(
        `Circular dependency detected: Token already in resolution stack`
      );
    }
    this.stack.add(token);
  }

  pop(token: Token): void {
    this.stack.delete(token);
  }

  has(token: Token): boolean {
    return this.stack.has(token);
  }
}

// ============= Container =============

export class Container {
  private providers = new Map<Token, ResolvedProvider>();
  private resolutionStack = new ResolutionStack();

  /**
   * Register a single provider
   */
  register<T>(provider: Provider<T>): void {
    if (this.providers.has(provider.token)) {
      throw new Error(
        `Provider already registered for token: ${String(provider.token)}`
      );
    }

    this.providers.set(provider.token, {
      provider: {
        ...provider,
        scope: provider.scope ?? 'singleton',
      },
    });
  }

  /**
   * Register multiple providers at once
   */
  registerAll(providers: Provider[]): void {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  /**
   * Check if a token is registered
   */
  has(token: Token): boolean {
    return this.providers.has(token);
  }

  /**
   * Resolve a token to its value
   */
  resolve<T>(token: Token<T>): T {
    const resolved = this.providers.get(token as Token);

    if (!resolved) {
      throw new Error(`No provider registered for token: ${String(token)}`);
    }

    const { provider } = resolved;

    // Check for circular dependencies
    if (this.resolutionStack.has(token as Token)) {
      throw new Error(
        `Circular dependency detected while resolving: ${String(token)}`
      );
    }

    // Singleton: return cached instance if available
    if (provider.scope === 'singleton' && resolved.instance !== undefined) {
      return resolved.instance as T;
    }

    // Track resolution for circular dependency detection
    this.resolutionStack.push(token as Token);

    try {
      const instance = this.createInstance<T>(provider);

      // Cache singleton instances
      if (provider.scope === 'singleton') {
        resolved.instance = instance;
      }

      return instance;
    } finally {
      this.resolutionStack.pop(token as Token);
    }
  }

  /**
   * Create an instance from a provider
   */
  private createInstance<T>(provider: Provider<T>): T {
    // useValue: return the value directly
    if (provider.useValue !== undefined) {
      return provider.useValue as T;
    }

    // useFactory: call factory with injected dependencies
    if (provider.useFactory) {
      const deps = this.resolveDeps(provider.inject ?? []);
      return provider.useFactory(...deps) as T;
    }

    // useClass: instantiate with injected dependencies
    if (provider.useClass) {
      const deps = this.resolveDeps(provider.inject ?? []);
      return new provider.useClass(...deps) as T;
    }

    throw new Error(
      `Invalid provider configuration for token: ${String(provider.token)}`
    );
  }

  /**
   * Resolve an array of dependency tokens
   */
  private resolveDeps(tokens: Token[]): unknown[] {
    return tokens.map((token) => this.resolve(token));
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.providers.clear();
  }

  /**
   * Get all registered tokens
   */
  getTokens(): Token[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Create a child container (for request-scoped containers)
   */
  createChild(): Container {
    const child = new Container();
    // Copy singleton providers to child
    for (const [token, resolved] of this.providers) {
      if (resolved.provider.scope === 'singleton') {
        child.providers.set(token, resolved);
      }
    }
    return child;
  }
}

// ============= Decorator Helpers =============

// WeakMap for container metadata storage
const containerMetadata = new WeakMap<object, Map<string, unknown>>();

function setContainerMetadata(target: object, key: string, value: unknown): void {
  if (!containerMetadata.has(target)) {
    containerMetadata.set(target, new Map());
  }
  containerMetadata.get(target)!.set(key, value);
}

function getContainerMetadata<T>(target: object, key: string): T | undefined {
  return containerMetadata.get(target)?.get(key) as T | undefined;
}

/**
 * Helper to create injectable class decorator
 */
export function Injectable(token?: Token): ClassDecorator {
  return function (target: abstract new (...args: unknown[]) => unknown) {
    setContainerMetadata(target, 'injectable', true);
    if (token) {
      setContainerMetadata(target, 'token', token);
    }
    return target;
  };
}

/**
 * Helper to create parameter injection metadata
 */
export function Inject(token: Token): ParameterDecorator {
  return function (
    target: unknown,
    propertyKey: string | symbol | undefined,
    parameterIndex: number
  ) {
    const targetObj = target as object;
    const existingTokens: Token[] = getContainerMetadata<Token[]>(targetObj, 'inject:tokens') ?? [];
    existingTokens[parameterIndex] = token;
    setContainerMetadata(targetObj, 'inject:tokens', existingTokens);
  };
}

// Export getter for use by modules
export { getContainerMetadata as getInjectTokens };
