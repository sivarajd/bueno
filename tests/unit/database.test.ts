import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database, detectDriver, createConnection } from '../../src/database';
import type { DatabaseConfig, DatabaseDriver } from '../../src/types';

describe('Database', () => {
  // Use SQLite for testing (no external dependencies)
  const testDbPath = ':memory:';
  
  describe('detectDriver', () => {
    test('should detect postgresql from URL', () => {
      expect(detectDriver('postgresql://user:pass@localhost/db')).toBe('postgresql');
    });

    test('should detect mysql from URL', () => {
      expect(detectDriver('mysql://user:pass@localhost/db')).toBe('mysql');
    });

    test('should detect sqlite from file path', () => {
      expect(detectDriver('./test.db')).toBe('sqlite');
      expect(detectDriver('/path/to/test.db')).toBe('sqlite');
    });

    test('should detect sqlite from sqlite:// URL', () => {
      expect(detectDriver('sqlite://./test.db')).toBe('sqlite');
    });
  });

  describe('Database (SQLite)', () => {
    let db: Database;

    beforeEach(async () => {
      db = new Database({ url: testDbPath });
      await db.connect();
      
      // Create test table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        )
      `);
    });

    afterEach(async () => {
      await db.close();
    });

    test('should connect to database', () => {
      expect(db.isConnected).toBe(true);
    });

    test('should execute queries', async () => {
      await db.execute("INSERT INTO users (name, email) VALUES ('John', 'john@example.com')");
      
      const count = await db.queryOne<{ count: number }>("SELECT COUNT(*) as count FROM users");
      expect(count?.count).toBe(1);
    });

    test('should query multiple rows', async () => {
      await db.execute("INSERT INTO users (name, email) VALUES ('John', 'john@example.com')");
      await db.execute("INSERT INTO users (name, email) VALUES ('Jane', 'jane@example.com')");
      
      const users = await db.query<{ id: number; name: string; email: string }>("SELECT * FROM users ORDER BY name");
      
      expect(users.length).toBe(2);
      expect(users[0].name).toBe('Jane');
      expect(users[1].name).toBe('John');
    });

    test('should query single row', async () => {
      await db.execute("INSERT INTO users (name, email) VALUES ('John', 'john@example.com')");
      
      const user = await db.queryOne<{ id: number; name: string }>("SELECT id, name FROM users WHERE email = ?", ['john@example.com']);
      
      expect(user).toBeDefined();
      expect(user?.name).toBe('John');
    });

    test('should return null for no results', async () => {
      const user = await db.queryOne("SELECT * FROM users WHERE email = ?", ['nonexistent@example.com']);
      expect(user).toBeNull();
    });

    test('should use prepared statements', async () => {
      const stmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
      
      await stmt.run('Alice', 'alice@example.com');
      await stmt.run('Bob', 'bob@example.com');
      
      const count = await db.queryOne<{ count: number }>("SELECT COUNT(*) as count FROM users");
      expect(count?.count).toBe(2);
    });

    test('should support transactions', async () => {
      await db.transaction(async (tx) => {
        await tx.execute("INSERT INTO users (name, email) VALUES ('TxUser', 'tx@example.com')");
      });
      
      const user = await db.queryOne("SELECT * FROM users WHERE email = ?", ['tx@example.com']);
      expect(user).toBeDefined();
    });

    test('should rollback on error', async () => {
      try {
        await db.transaction(async (tx) => {
          await tx.execute("INSERT INTO users (name, email) VALUES ('User1', 'user1@example.com')");
          // This should fail due to unique constraint
          await tx.execute("INSERT INTO users (name, email) VALUES ('User2', 'user1@example.com')");
        });
      } catch (error) {
        // Expected
      }
      
      const count = await db.queryOne<{ count: number }>("SELECT COUNT(*) as count FROM users");
      expect(count?.count).toBe(0); // Should be rolled back
    });

    test('should close connection', async () => {
      await db.close();
      expect(db.isConnected).toBe(false);
    });
  });

  describe('createConnection', () => {
    test('should create database connection', async () => {
      const db = await createConnection({ url: testDbPath });
      expect(db.isConnected).toBe(true);
      await db.close();
    });
  });
});
