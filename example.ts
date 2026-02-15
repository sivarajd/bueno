/**
 * Bueno Framework - Quick Start Example
 * 
 * Run with: bun run example.ts
 */

import {
  Router,
  Context,
  createServer,
  logger,
  cors,
  createValidator,
  z,
  Password,
  JWT,
  createCache,
  Database,
} from './src';

// ============= Simple Server Example =============

async function main() {
  console.log('🚀 Starting Bueno Server...\n');

  // Create router
  const router = new Router();

  // Apply middleware to routes
  const publicRoutes = router.group('/api', {
    middleware: [cors()],
  });

  // Basic routes
  publicRoutes.get('/', (ctx: Context) => {
    return ctx.json({ message: 'Welcome to Bueno!' });
  });

  publicRoutes.get('/users/:id', (ctx: Context) => {
    return ctx.json({ 
      id: parseInt(ctx.params.id), 
      name: 'John Doe',
      query: ctx.query,
    });
  });

  // Validation example
  const UserSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
  });

  const validateUser = createValidator({ body: UserSchema });

  publicRoutes.post('/users', validateUser, async (ctx: Context) => {
    const user = ctx.get('validatedBody');
    return ctx.status(201).json({ 
      created: true, 
      user 
    });
  });

  // Password hashing example
  publicRoutes.post('/hash', async (ctx: Context) => {
    const body = await ctx.body<{ password: string }>();
    if (!body?.password) {
      return ctx.status(400).json({ error: 'Password required' });
    }
    const hash = await Password.hash(body.password);
    return ctx.json({ hash });
  });

  // JWT example
  const jwt = new JWT('my-secret-key', { expiresIn: '1h' });

  publicRoutes.post('/login', async (ctx: Context) => {
    const body = await ctx.body<{ email: string }>();
    const token = await jwt.sign({ email: body?.email, userId: 1 });
    return ctx.json({ token });
  });

  publicRoutes.get('/protected', async (ctx: Context) => {
    const authHeader = ctx.getHeader('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return ctx.status(401).json({ error: 'Missing token' });
    }
    const token = authHeader.slice(7);
    const payload = await jwt.verify(token);
    if (!payload) {
      return ctx.status(401).json({ error: 'Invalid token' });
    }
    return ctx.json({ user: payload });
  });

  // Cache example
  const cache = createCache({ driver: 'memory', ttl: 60 });
  await cache.connect();

  publicRoutes.get('/cached', async (ctx: Context) => {
    const data = await cache.getOrSet('cached-data', async () => {
      // Expensive operation
      return { timestamp: Date.now(), value: 'Cached response' };
    });
    return ctx.json(data);
  });

  // Database example (SQLite in-memory)
  const db = new Database({ url: ':memory:' });
  await db.connect();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);

  publicRoutes.get('/items', async (ctx: Context) => {
    const items = await db.query('SELECT * FROM items');
    return ctx.json(items);
  });

  publicRoutes.post('/items', async (ctx: Context) => {
    const body = await ctx.body<{ name: string }>();
    if (!body?.name) {
      return ctx.status(400).json({ error: 'Name required' });
    }
    await db.execute('INSERT INTO items (name) VALUES (?)', [body.name]);
    return ctx.status(201).json({ created: true });
  });

  // Start server
  const server = createServer({ port: 3000 });
  server.router = router;
  
  await server.listen();

  console.log(`
📊 Available endpoints:
  GET  /api/              - Welcome message
  GET  /api/users/:id     - Get user by ID
  POST /api/users         - Create user (with validation)
  POST /api/hash          - Hash password
  POST /api/login         - Get JWT token
  GET  /api/protected     - Protected route (requires JWT)
  GET  /api/cached        - Cached response
  GET  /api/items         - List items
  POST /api/items         - Create item

🧪 Test examples:
  curl http://localhost:3000/api/
  curl http://localhost:3000/api/users/123?page=1
  curl -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d '{"name":"John","email":"john@example.com"}'
  curl -X POST http://localhost:3000/api/hash -H "Content-Type: application/json" -d '{"password":"secret123"}'
  curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"email":"user@example.com"}'
  `);
}

main().catch(console.error);
