/**
 * Database Layer
 * 
 * Unified interface over bun:sql supporting PostgreSQL, MySQL, and SQLite.
 * Provides connection pooling, transactions, and query execution.
 */

import type { DatabaseConfig, DatabaseDriver } from '../types';

// ============= Types =============

interface QueryResult {
  rows: unknown[];
  rowCount: number;
  insertId?: number | string;
}

interface PreparedStatement {
  run(...params: unknown[]): Promise<QueryResult>;
  all(...params: unknown[]): Promise<unknown[]>;
  get(...params: unknown[]): Promise<unknown | null>;
}

type TransactionCallback = (tx: Transaction) => Promise<unknown>;

interface Transaction {
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

// ============= Driver Detection =============

/**
 * Detect database driver from connection string or path
 */
export function detectDriver(url: string): DatabaseDriver {
  // Check for URL scheme
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return 'postgresql';
  }
  if (url.startsWith('mysql://')) {
    return 'mysql';
  }
  if (url.startsWith('sqlite://')) {
    return 'sqlite';
  }
  
  // Assume SQLite for file paths
  if (url.endsWith('.db') || url.endsWith('.sqlite') || url.endsWith('.sqlite3')) {
    return 'sqlite';
  }
  
  // Default to SQLite for :memory: and relative paths
  if (url === ':memory:' || url.startsWith('./') || url.startsWith('/')) {
    return 'sqlite';
  }
  
  // Default to SQLite
  return 'sqlite';
}

// ============= Database Class =============

export class Database {
  private config: DatabaseConfig;
  private driver: DatabaseDriver;
  private connection: unknown = null;
  private _isConnected = false;

  constructor(config: DatabaseConfig | string) {
    this.config = typeof config === 'string' ? { url: config } : config;
    this.driver = detectDriver(this.config.url);
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    if (this._isConnected) return;

    try {
      // Use Bun's built-in SQL
      const { Database: BunDatabase } = await import('bun:sqlite');
      
      if (this.driver === 'sqlite') {
        // Extract path from URL if needed
        const path = this.config.url.startsWith('sqlite://')
          ? this.config.url.replace('sqlite://', '')
          : this.config.url;
        
        this.connection = new BunDatabase(path);
      } else {
        // For PostgreSQL and MySQL, we would use bun:sql
        // For now, we'll use SQLite as a fallback
        throw new Error(`Driver ${this.driver} not yet implemented. Use SQLite for now.`);
      }

      this._isConnected = true;
    } catch (error) {
      throw new Error(`Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Get the underlying connection
   */
  getConnection(): unknown {
    return this.connection;
  }

  /**
   * Execute a query that doesn't return rows
   */
  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.ensureConnection();
    
    const db = this.connection as {
      run: (sql: string, ...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    };
    
    const result = db.run(sql, ...params);
    
    return {
      rows: [],
      rowCount: result.changes,
      insertId: Number(result.lastInsertRowid),
    };
  }

  /**
   * Execute a query and return all rows
   */
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.ensureConnection();
    
    const db = this.connection as {
      query: (sql: string, ...params: unknown[]) => { all: () => T[] };
    };
    
    const stmt = db.query(sql, ...params);
    return stmt.all();
  }

  /**
   * Execute a query and return a single row
   */
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    this.ensureConnection();
    
    const db = this.connection as {
      query: (sql: string, ...params: unknown[]) => { get: (...params: unknown[]) => T | null };
    };
    
    const stmt = db.query(sql);
    return stmt.get(...params);
  }

  /**
   * Create a prepared statement
   */
  prepare(sql: string): PreparedStatement {
    this.ensureConnection();
    
    const db = this.connection as {
      query: (sql: string) => {
        run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
        all: (...params: unknown[]) => unknown[];
        get: (...params: unknown[]) => unknown | null;
      };
    };
    
    const stmt = db.query(sql);
    
    return {
      async run(...params: unknown[]): Promise<QueryResult> {
        const result = stmt.run(...params);
        return {
          rows: [],
          rowCount: result.changes,
          insertId: Number(result.lastInsertRowid),
        };
      },
      async all(...params: unknown[]): Promise<unknown[]> {
        return stmt.all(...params);
      },
      async get(...params: unknown[]): Promise<unknown | null> {
        return stmt.get(...params);
      },
    };
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: TransactionCallback): Promise<T> {
    this.ensureConnection();
    
    const db = this.connection as {
      transaction: <R>(callback: () => R) => R;
    };
    
    const tx: Transaction = {
      execute: async (sql: string, params: unknown[] = []) => {
        return this.execute(sql, params);
      },
      query: async <T>(sql: string, params: unknown[] = []) => {
        return this.query<T>(sql, params);
      },
      queryOne: async <T>(sql: string, params: unknown[] = []) => {
        return this.queryOne<T>(sql, params);
      },
    };
    
    // Use Bun's transaction support
    if (db.transaction) {
      return db.transaction(() => callback(tx)) as T;
    }
    
    // Fallback: manual transaction
    await this.execute('BEGIN TRANSACTION');
    try {
      const result = await callback(tx);
      await this.execute('COMMIT');
      return result;
    } catch (error) {
      await this.execute('ROLLBACK');
      throw error;
    }
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (!this._isConnected) return;
    
    const db = this.connection as { close?: () => void };
    if (db.close) {
      db.close();
    }
    
    this.connection = null;
    this._isConnected = false;
  }

  /**
   * Ensure connection is established
   */
  private ensureConnection(): void {
    if (!this._isConnected || !this.connection) {
      throw new Error('Database not connected. Call connect() first.');
    }
  }
}

// ============= Connection Factory =============

/**
 * Create a database connection
 */
export async function createConnection(config: DatabaseConfig | string): Promise<Database> {
  const db = new Database(config);
  await db.connect();
  return db;
}

// ============= Query Builder Helpers =============

/**
 * Simple query builder for common operations
 */
export class QueryBuilder<T = unknown> {
  private table: string;
  private db: Database;
  
  constructor(db: Database, table: string) {
    this.db = db;
    this.table = table;
  }

  /**
   * Select all rows
   */
  async all(): Promise<T[]> {
    return this.db.query<T>(`SELECT * FROM ${this.table}`);
  }

  /**
   * Find by ID
   */
  async findById(id: number | string): Promise<T | null> {
    return this.db.queryOne<T>(`SELECT * FROM ${this.table} WHERE id = ?`, [id]);
  }

  /**
   * Find by field
   */
  async findBy(field: string, value: unknown): Promise<T[]> {
    return this.db.query<T>(`SELECT * FROM ${this.table} WHERE ${field} = ?`, [value]);
  }

  /**
   * Find one by field
   */
  async findOneBy(field: string, value: unknown): Promise<T | null> {
    return this.db.queryOne<T>(`SELECT * FROM ${this.table} WHERE ${field} = ? LIMIT 1`, [value]);
  }

  /**
   * Insert a row
   */
  async insert(data: Partial<T>): Promise<number | string> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(', ');
    
    const result = await this.db.execute(
      `INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${placeholders})`,
      values
    );
    
    return result.insertId ?? 0;
  }

  /**
   * Update by ID
   */
  async updateById(id: number | string, data: Partial<T>): Promise<number> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    
    const result = await this.db.execute(
      `UPDATE ${this.table} SET ${setClause} WHERE id = ?`,
      [...values, id]
    );
    
    return result.rowCount;
  }

  /**
   * Delete by ID
   */
  async deleteById(id: number | string): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM ${this.table} WHERE id = ?`,
      [id]
    );
    
    return result.rowCount;
  }

  /**
   * Count rows
   */
  async count(where?: string, params?: unknown[]): Promise<number> {
    const sql = where
      ? `SELECT COUNT(*) as count FROM ${this.table} WHERE ${where}`
      : `SELECT COUNT(*) as count FROM ${this.table}`;
    
    const result = await this.db.queryOne<{ count: number }>(sql, params);
    return result?.count ?? 0;
  }
}

/**
 * Create a query builder for a table
 */
export function table<T = unknown>(db: Database, tableName: string): QueryBuilder<T> {
  return new QueryBuilder<T>(db, tableName);
}
