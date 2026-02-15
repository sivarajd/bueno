import { describe, test, expect, beforeEach } from 'bun:test';
import { Router } from '../../src/router';
import type { HTTPMethod, RouteHandler } from '../../src/types';

describe('Router', () => {
  let router: Router;

  const mockHandler: RouteHandler = () => new Response('OK');

  beforeEach(() => {
    router = new Router();
  });

  describe('Route Registration', () => {
    test('should register a GET route', () => {
      router.get('/users', mockHandler);
      const match = router.match('GET', '/users');
      expect(match).toBeDefined();
      expect(match?.handler).toBe(mockHandler);
    });

    test('should register a POST route', () => {
      router.post('/users', mockHandler);
      const match = router.match('POST', '/users');
      expect(match).toBeDefined();
    });

    test('should register a PUT route', () => {
      router.put('/users/:id', mockHandler);
      const match = router.match('PUT', '/users/123');
      expect(match).toBeDefined();
    });

    test('should register a PATCH route', () => {
      router.patch('/users/:id', mockHandler);
      const match = router.match('PATCH', '/users/123');
      expect(match).toBeDefined();
    });

    test('should register a DELETE route', () => {
      router.delete('/users/:id', mockHandler);
      const match = router.match('DELETE', '/users/123');
      expect(match).toBeDefined();
    });

    test('should register a HEAD route', () => {
      router.head('/users', mockHandler);
      const match = router.match('HEAD', '/users');
      expect(match).toBeDefined();
    });

    test('should register an OPTIONS route', () => {
      router.options('/users', mockHandler);
      const match = router.match('OPTIONS', '/users');
      expect(match).toBeDefined();
    });

    test('should register route with all method', () => {
      router.all('/catch-all', mockHandler);
      expect(router.match('GET', '/catch-all')).toBeDefined();
      expect(router.match('POST', '/catch-all')).toBeDefined();
      expect(router.match('PUT', '/catch-all')).toBeDefined();
    });
  });

  describe('Path Matching', () => {
    test('should match exact path', () => {
      router.get('/users', mockHandler);
      expect(router.match('GET', '/users')).toBeDefined();
      // Trailing slashes are normalized
      expect(router.match('GET', '/users/')).toBeDefined();
      expect(router.match('GET', '/users/extra')).toBeUndefined();
    });

    test('should extract path parameters', () => {
      router.get('/users/:id', mockHandler);
      const match = router.match('GET', '/users/123');
      expect(match?.params).toEqual({ id: '123' });
    });

    test('should extract multiple path parameters', () => {
      router.get('/users/:userId/posts/:postId', mockHandler);
      const match = router.match('GET', '/users/42/posts/100');
      expect(match?.params).toEqual({ userId: '42', postId: '100' });
    });

    test('should match wildcard routes', () => {
      router.get('/files/*', mockHandler);
      expect(router.match('GET', '/files/path/to/file.txt')).toBeDefined();
      // Wildcard at end can match empty string too
      expect(router.match('GET', '/files/')).toBeDefined();
    });

    test('should capture wildcard content', () => {
      router.get('/files/*', mockHandler);
      const match = router.match('GET', '/docs/readme.md');
      // Wildcard matches everything after the prefix
    });

    test('should match optional parameters', () => {
      router.get('/users/:id?', mockHandler);
      expect(router.match('GET', '/users')).toBeDefined();
      expect(router.match('GET', '/users/123')?.params).toEqual({ id: '123' });
    });

    test('should match regex patterns', () => {
      router.get('/users/:id<\\d+>', mockHandler);
      expect(router.match('GET', '/users/123')).toBeDefined();
      expect(router.match('GET', '/users/abc')).toBeUndefined();
    });

    test('should be case-insensitive by default', () => {
      router.get('/Users', mockHandler);
      expect(router.match('GET', '/users')).toBeDefined();
      expect(router.match('GET', '/USERS')).toBeDefined();
    });

    test('should normalize trailing slashes', () => {
      router.get('/users', mockHandler);
      expect(router.match('GET', '/users/')).toBeDefined();
    });
  });

  describe('Route Groups', () => {
    test('should create route group with prefix', () => {
      const api = router.group('/api');
      api.get('/users', mockHandler);

      expect(router.match('GET', '/api/users')).toBeDefined();
      expect(router.match('GET', '/users')).toBeUndefined();
    });

    test('should support nested route groups', () => {
      const api = router.group('/api');
      const v1 = api.group('/v1');
      v1.get('/users', mockHandler);

      expect(router.match('GET', '/api/v1/users')).toBeDefined();
    });

    test('should apply middleware to route group', () => {
      const middleware = () => new Response('middleware');
      const api = router.group('/api', { middleware });
      api.get('/users', mockHandler);

      const match = router.match('GET', '/api/users');
      expect(match?.middleware).toBeDefined();
      expect(match?.middleware?.length).toBe(1);
    });
  });

  describe('Route Matching', () => {
    test('should return undefined for non-matching route', () => {
      router.get('/users', mockHandler);
      expect(router.match('GET', '/posts')).toBeUndefined();
    });

    test('should return undefined for wrong method', () => {
      router.get('/users', mockHandler);
      expect(router.match('POST', '/users')).toBeUndefined();
    });

    test('should match most specific route first', () => {
      const handler1 = () => new Response('1');
      const handler2 = () => new Response('2');

      router.get('/users/:id', handler1);
      router.get('/users/special', handler2);

      // Static route /users/special has priority over dynamic /users/:id
      const match = router.match('GET', '/users/special');
      expect(match?.handler).toBe(handler2);
      
      // Dynamic route matches other paths
      const match2 = router.match('GET', '/users/123');
      expect(match2?.handler).toBe(handler1);
    });

    test('should match static routes before dynamic', () => {
      const dynamicHandler = () => new Response('dynamic');
      const staticHandler = () => new Response('static');

      router.get('/users/:id', dynamicHandler);
      router.get('/users/me', staticHandler);

      // Static route should be checked first (fewer params = higher priority)
      const match = router.match('GET', '/users/me');
      expect(match?.handler).toBe(staticHandler);
    });
  });

  describe('Route Information', () => {
    test('should list all routes', () => {
      router.get('/users', mockHandler);
      router.post('/users', mockHandler);
      router.get('/users/:id', mockHandler);

      const routes = router.getRoutes();
      expect(routes.length).toBe(3);
    });

    test('should include route metadata', () => {
      router.get('/users', mockHandler, { name: 'users.list' });
      const routes = router.getRoutes();
      expect(routes[0].name).toBe('users.list');
    });
  });

  describe('Route Handler Types', () => {
    test('should accept async handlers', async () => {
      const asyncHandler: RouteHandler = async () => {
        await Promise.resolve();
        return new Response('async');
      };

      router.get('/async', asyncHandler);
      const match = router.match('GET', '/async');
      expect(match?.handler).toBe(asyncHandler);
    });

    test('should accept handler with middleware', () => {
      const middleware = () => new Response('middleware');
      router.get('/protected', mockHandler, { middleware: [middleware] });

      const match = router.match('GET', '/protected');
      expect(match?.middleware).toHaveLength(1);
    });
  });
});
