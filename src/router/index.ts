/**
 * Router System
 * 
 * High-performance HTTP router with support for:
 * - Path parameters (:id)
 * - Wildcards (*)
 * - Regex patterns (:id<\\d+>)
 * - Optional parameters (:id?)
 * - Route groups with middleware
 */

import type { HTTPMethod, MiddlewareHandler, PathParams, RouteHandler } from '../types';

// ============= Types =============

export interface RouteMatch {
  handler: RouteHandler;
  params: PathParams;
  middleware?: MiddlewareHandler[];
  name?: string;
}

interface RouteEntry {
  method: HTTPMethod | 'ALL';
  pattern: string;
  handler: RouteHandler;
  middleware?: MiddlewareHandler[];
  name?: string;
  regex: RegExp;
  paramNames: string[];
  isStatic: boolean;
  priority: number;
}

interface RouteOptions {
  name?: string;
  middleware?: MiddlewareHandler | MiddlewareHandler[];
}

// ============= Pattern Utilities =============

/**
 * Convert route pattern to regex and extract parameter names
 */
function patternToRegex(pattern: string): { regex: RegExp; paramNames: string[]; isStatic: boolean; hasWildcard: boolean } {
  const paramNames: string[] = [];
  let isStatic = true;
  let hasWildcard = false;

  // Process pattern segments
  const segments: string[] = [];
  let i = 0;
  
  while (i < pattern.length) {
    if (pattern[i] === ':') {
      // Parameter
      i++; // skip ':'
      
      // Get parameter name
      let name = '';
      while (i < pattern.length && /[a-zA-Z0-9_]/.test(pattern[i])) {
        name += pattern[i];
        i++;
      }
      
      // Check for optional marker AFTER the name
      let optional = false;
      if (i < pattern.length && pattern[i] === '?') {
        optional = true;
        i++;
      }
      
      // Check for custom regex
      let customRegex = '';
      if (i < pattern.length && pattern[i] === '<') {
        i++; // skip '<'
        while (i < pattern.length && pattern[i] !== '>') {
          customRegex += pattern[i];
          i++;
        }
        i++; // skip '>'
      }
      
      paramNames.push(name);
      isStatic = false;
      
      if (optional) {
        // Remove the preceding slash and make the whole segment optional
        if (segments.length > 0 && segments[segments.length - 1] === '/') {
          segments.pop();
        }
        segments.push('(?:/([^/]*))?');
      } else if (customRegex) {
        segments.push(`(${customRegex})`);
      } else {
        segments.push('([^/]+)');
      }
    } else if (pattern[i] === '*') {
      // Wildcard
      hasWildcard = true;
      isStatic = false;
      paramNames.push('*');
      segments.push('(.*)');
      i++;
    } else {
      // Regular character - escape special regex chars
      const char = pattern[i];
      if (/[.+^${}()|[\]\\]/.test(char)) {
        segments.push('\\' + char);
      } else {
        segments.push(char);
      }
      i++;
    }
  }

  const regexStr = `^${segments.join('')}/?$`;

  return {
    regex: new RegExp(regexStr, 'i'),
    paramNames,
    isStatic,
    hasWildcard,
  };
}

/**
 * Extract params from match groups
 */
function extractParams(regex: RegExp, paramNames: string[], pathname: string): PathParams {
  const params: PathParams = {};
  const match = pathname.match(regex);

  if (match) {
    paramNames.forEach((name, index) => {
      if (match[index + 1] !== undefined) {
        params[name] = match[index + 1];
      }
    });
  }

  return params;
}

// ============= Router Class =============

export class Router {
  private routes: RouteEntry[] = [];
  private groupPrefix = '';
  private groupMiddleware: MiddlewareHandler[] = [];
  private routeCounter = 0;

  /**
   * Register a route with specific HTTP method
   */
  private addRoute(
    method: HTTPMethod | 'ALL',
    pattern: string,
    handler: RouteHandler,
    options?: RouteOptions
  ): void {
    const fullPattern = this.groupPrefix + pattern;
    const { regex, paramNames, isStatic } = patternToRegex(fullPattern);
    
    // Handle middleware as either a single handler or array
    const optsMiddleware = options?.middleware;
    const routeMiddleware: MiddlewareHandler[] = optsMiddleware 
      ? (Array.isArray(optsMiddleware) ? optsMiddleware : [optsMiddleware])
      : [];

    this.routes.push({
      method,
      pattern: fullPattern,
      handler,
      middleware: [...this.groupMiddleware, ...routeMiddleware],
      name: options?.name,
      regex,
      paramNames,
      isStatic,
      priority: this.routeCounter++,
    });

    // Sort routes: static first, then by specificity (fewer params first)
    this.sortRoutes();
  }

  /**
   * Sort routes for optimal matching
   */
  private sortRoutes(): void {
    this.routes.sort((a, b) => {
      // Static routes first
      if (a.isStatic !== b.isStatic) {
        return a.isStatic ? -1 : 1;
      }
      // Fewer params = higher priority
      if (a.paramNames.length !== b.paramNames.length) {
        return a.paramNames.length - b.paramNames.length;
      }
      // Registration order
      return a.priority - b.priority;
    });
  }

  /**
   * Match a route by method and pathname
   */
  match(method: HTTPMethod | 'ALL', pathname: string): RouteMatch | undefined {
    for (const route of this.routes) {
      if (route.method !== 'ALL' && route.method !== method) {
        continue;
      }

      if (route.regex.test(pathname)) {
        const params = extractParams(route.regex, route.paramNames, pathname);
        return {
          handler: route.handler,
          params,
          middleware: route.middleware,
          name: route.name,
        };
      }
    }

    return undefined;
  }

  /**
   * Create a route group with prefix and optional middleware
   */
  group(prefix: string, options?: { middleware?: MiddlewareHandler | MiddlewareHandler[] }): Router {
    const childRouter = new Router();
    childRouter.routes = this.routes;
    childRouter.groupPrefix = this.groupPrefix + prefix;
    
    // Handle middleware as either a single handler or array
    const optsMiddleware = options?.middleware;
    const middlewareArray: MiddlewareHandler[] = optsMiddleware 
      ? (Array.isArray(optsMiddleware) ? optsMiddleware : [optsMiddleware])
      : [];
    
    childRouter.groupMiddleware = [...this.groupMiddleware, ...middlewareArray];
    childRouter.routeCounter = this.routeCounter;

    return childRouter;
  }

  /**
   * Get all registered routes
   */
  getRoutes(): Array<{
    method: HTTPMethod | 'ALL';
    pattern: string;
    name?: string;
  }> {
    return this.routes.map((r) => ({
      method: r.method,
      pattern: r.pattern,
      name: r.name,
    }));
  }

  // ============= HTTP Method Helpers =============

  get(pattern: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('GET', pattern, handler, options);
  }

  post(pattern: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('POST', pattern, handler, options);
  }

  put(pattern: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('PUT', pattern, handler, options);
  }

  patch(pattern: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('PATCH', pattern, handler, options);
  }

  delete(pattern: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('DELETE', pattern, handler, options);
  }

  head(pattern: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('HEAD', pattern, handler, options);
  }

  options(pattern: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('OPTIONS', pattern, handler, options);
  }

  all(pattern: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('ALL', pattern, handler, options);
  }
}

// ============= Utility: Route URL Generation =============

/**
 * Generate URL from route pattern and params
 */
export function generateUrl(pattern: string, params: PathParams = {}): string {
  return pattern
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\?/g, (_, name) => params[name] ?? '')
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)<[^>]+>/g, (_, name) => params[name] ?? '')
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      if (params[name] === undefined) {
        throw new Error(`Missing required parameter: ${name}`);
      }
      return params[name];
    })
    .replace(/\*/g, () => params['*'] ?? '');
}
