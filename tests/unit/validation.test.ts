import { describe, test, expect, beforeEach } from 'bun:test';
import { validate, validateBody, validateQuery, validateParams, createValidator } from '../../src/validation';
import { Context } from '../../src/context';
import { z } from 'zod';

// User schema for testing
const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

const IdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const QuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(10),
  search: z.string().optional(),
});

describe('Validation', () => {
  describe('validate', () => {
    test('should validate valid data', () => {
      const data = { name: 'John', email: 'john@example.com' };
      const result = validate(UserSchema, data);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('John');
        expect(result.data.email).toBe('john@example.com');
      }
    });

    test('should return errors for invalid data', () => {
      const data = { name: '', email: 'invalid-email' };
      const result = validate(UserSchema, data);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues.length).toBeGreaterThan(0);
      }
    });

    test('should transform data', () => {
      const data = { id: '123' };
      const result = validate(IdSchema, data);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(123);
      }
    });
  });

  describe('validateBody', () => {
    test('should validate request body', async () => {
      const request = new Request('http://localhost:3000/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
      });
      const context = new Context(request, {});

      const result = await validateBody(context, UserSchema);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('John');
      }
    });

    test('should handle invalid JSON body', async () => {
      const request = new Request('http://localhost:3000/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      const context = new Context(request, {});

      const result = await validateBody(context, UserSchema);
      
      expect(result.success).toBe(false);
    });
  });

  describe('validateQuery', () => {
    test('should validate query parameters', () => {
      const request = new Request('http://localhost:3000/users?page=2&limit=20&search=john');
      const context = new Context(request, {});

      const result = validateQuery(context, QuerySchema);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(20);
        expect(result.data.search).toBe('john');
      }
    });

    test('should use default values', () => {
      const request = new Request('http://localhost:3000/users');
      const context = new Context(request, {});

      const result = validateQuery(context, QuerySchema);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(10);
      }
    });
  });

  describe('validateParams', () => {
    test('should validate path parameters', () => {
      const request = new Request('http://localhost:3000/users/123');
      const context = new Context(request, { id: '123' });

      const result = validateParams(context, IdSchema);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(123);
      }
    });

    test('should fail for invalid path parameter', () => {
      const request = new Request('http://localhost:3000/users/abc');
      const context = new Context(request, { id: 'abc' });

      const result = validateParams(context, IdSchema);
      
      expect(result.success).toBe(false);
    });
  });

  describe('createValidator', () => {
    test('should create validation middleware', async () => {
      const validator = createValidator({
        body: UserSchema,
      });

      const request = new Request('http://localhost:3000/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
      });
      const context = new Context(request, {});

      const next = () => Promise.resolve(new Response('OK'));
      const response = await validator(context, next);

      expect(response.status).toBe(200);
      expect(context.get('validatedBody')).toBeDefined();
    });

    test('should return 400 for validation errors', async () => {
      const validator = createValidator({
        body: UserSchema,
      });

      const request = new Request('http://localhost:3000/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', email: 'invalid' }),
      });
      const context = new Context(request, {});

      const next = () => Promise.resolve(new Response('OK'));
      const response = await validator(context, next);

      expect(response.status).toBe(400);
    });
  });
});
