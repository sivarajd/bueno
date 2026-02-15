import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createRPClient, extractRouteTypes, type RPCClient } from '../../src/rpc';
import { Router } from '../../src/router';
import { Application } from '../../src/modules';
import { Context } from '../../src/context';

// Mock app for testing
const mockHandler = (ctx: Context) => ctx.json({ success: true });

const createMockApp = () => {
  const router = new Router();
  router.get('/users', (ctx) => ctx.json([{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }]));
  router.get('/users/:id', (ctx) => ctx.json({ id: parseInt(ctx.params.id), name: 'User' }));
  router.post('/users', (ctx) => ctx.json({ created: true }));
  router.put('/users/:id', (ctx) => ctx.json({ updated: true }));
  router.delete('/users/:id', (ctx) => ctx.json({ deleted: true }));
  
  return router;
};

describe('RPC Client', () => {
  let client: RPCClient;
  let server: ReturnType<typeof Bun.serve>;
  let router: Router;

  beforeEach(async () => {
    router = createMockApp();
    
    // Start test server
    server = Bun.serve({
      port: 3999,
      fetch: async (request: Request) => {
        const url = new URL(request.url);
        const match = router.match(request.method as 'GET', url.pathname);
        
        if (!match) {
          return new Response('Not Found', { status: 404 });
        }
        
        const context = new Context(request, match.params);
        return match.handler(context);
      },
    });

    client = createRPClient({
      baseUrl: 'http://localhost:3999',
    });
  });

  afterEach(() => {
    server.stop();
  });

  describe('HTTP Methods', () => {
    test('should make GET request', async () => {
      const response = await client.get('/users');
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data).toEqual([{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }]);
    });

    test('should make GET request with path params', async () => {
      const response = await client.get('/users/123');
      const data = await response.json();
      
      expect(data).toEqual({ id: 123, name: 'User' });
    });

    test('should make POST request with body', async () => {
      const response = await client.post('/users', { name: 'New User' });
      const data = await response.json();
      
      expect(data).toEqual({ created: true });
    });

    test('should make PUT request', async () => {
      const response = await client.put('/users/123', { name: 'Updated' });
      const data = await response.json();
      
      expect(data).toEqual({ updated: true });
    });

    test('should make DELETE request', async () => {
      const response = await client.delete('/users/123');
      const data = await response.json();
      
      expect(data).toEqual({ deleted: true });
    });
  });

  describe('Request Options', () => {
    test('should include custom headers', async () => {
      const response = await client.get('/users', {
        headers: { 'X-Custom': 'value' },
      });
      
      expect(response.status).toBe(200);
    });

    test('should include query parameters', async () => {
      const response = await client.get('/users', {
        query: { page: '1', limit: '10' },
      });
      
      expect(response.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    test('should handle 404', async () => {
      const response = await client.get('/nonexistent');
      expect(response.status).toBe(404);
    });
  });
});

describe('extractRouteTypes', () => {
  test('should extract route information', () => {
    const router = createMockApp();
    const routes = extractRouteTypes(router);
    
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0]).toHaveProperty('method');
    expect(routes[0]).toHaveProperty('path');
  });
});
