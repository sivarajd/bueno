# Bueno

A Bun-Native Full-Stack Framework.

## Installation

```bash
bun add bueno
```

## Quick Start

```typescript
import { createServer, Router } from 'bueno';

const router = new Router();

router.get('/hello', (ctx) => {
  return ctx.json({ message: 'Hello, World!' });
});

const server = createServer();
server.router = router;
server.listen(3000);
```

## Documentation

For detailed documentation, visit [bueno.github.io](https://bueno.github.io).

## License

MIT
