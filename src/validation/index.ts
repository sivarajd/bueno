/**
 * Validation System
 * 
 * Provides schema-based validation using Zod with support for
 * body, query, params, and headers validation.
 */

import type { Context } from '../context';
import type { Middleware, ValidationTarget, StandardIssue } from '../types';

// Re-export Zod for convenience
export { z } from 'zod';
import { z, ZodSchema, ZodError } from 'zod';

// ============= Types =============

export type ValidationResult<T> = 
  | { success: true; data: T }
  | { success: false; issues: StandardIssue[] };

export interface ValidatorOptions {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  headers?: ZodSchema;
}

// ============= Validation Functions =============

/**
 * Validate data against a Zod schema
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): ValidationResult<T> {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof ZodError) {
      // Zod 4 uses 'issues' instead of 'errors'
      const issues: StandardIssue[] = (error.issues ?? error.errors ?? []).map(e => ({
        message: e.message,
        path: e.path,
      }));
      return { success: false, issues };
    }
    return { 
      success: false, 
      issues: [{ message: error instanceof Error ? error.message : 'Validation failed' }] 
    };
  }
}

/**
 * Validate request body
 */
export async function validateBody<T>(context: Context, schema: ZodSchema<T>): Promise<ValidationResult<T>> {
  try {
    const body = await context.body();
    return validate(schema, body);
  } catch (error) {
    return {
      success: false,
      issues: [{ message: 'Failed to parse request body' }],
    };
  }
}

/**
 * Validate query parameters
 */
export function validateQuery<T>(context: Context, schema: ZodSchema<T>): ValidationResult<T> {
  return validate(schema, context.query);
}

/**
 * Validate path parameters
 */
export function validateParams<T>(context: Context, schema: ZodSchema<T>): ValidationResult<T> {
  return validate(schema, context.params);
}

/**
 * Validate headers
 */
export function validateHeaders<T>(context: Context, schema: ZodSchema<T>): ValidationResult<T> {
  const headers: Record<string, string> = {};
  context.req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return validate(schema, headers);
}

// ============= Validation Middleware =============

/**
 * Create validation middleware
 */
export function createValidator(options: ValidatorOptions): Middleware {
  return async (context: Context, next: () => Promise<Response>) => {
    // Validate body
    if (options.body) {
      const result = await validateBody(context, options.body);
      if (!result.success) {
        return context
          .status(400)
          .json({ error: 'Validation failed', issues: result.issues });
      }
      context.set('validatedBody', result.data);
    }

    // Validate query
    if (options.query) {
      const result = validateQuery(context, options.query);
      if (!result.success) {
        return context
          .status(400)
          .json({ error: 'Validation failed', issues: result.issues });
      }
      context.set('validatedQuery', result.data);
    }

    // Validate params
    if (options.params) {
      const result = validateParams(context, options.params);
      if (!result.success) {
        return context
          .status(400)
          .json({ error: 'Validation failed', issues: result.issues });
      }
      context.set('validatedParams', result.data);
    }

    // Validate headers
    if (options.headers) {
      const result = validateHeaders(context, options.headers);
      if (!result.success) {
        return context
          .status(400)
          .json({ error: 'Validation failed', issues: result.issues });
      }
      context.set('validatedHeaders', result.data);
    }

    return next();
  };
}

// ============= Helper Decorators for Routes =============

/**
 * Body validation decorator for route handlers
 */
export function WithBody(schema: ZodSchema) {
  return function (
    target: unknown,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;
    descriptor.value = async function (context: Context) {
      const result = await validateBody(context, schema);
      if (!result.success) {
        return context.status(400).json({ error: 'Validation failed', issues: result.issues });
      }
      context.set('body', result.data);
      return original.call(this, context);
    };
    return descriptor;
  };
}

/**
 * Query validation decorator for route handlers
 */
export function WithQuery(schema: ZodSchema) {
  return function (
    target: unknown,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;
    descriptor.value = async function (context: Context) {
      const result = validateQuery(context, schema);
      if (!result.success) {
        return context.status(400).json({ error: 'Validation failed', issues: result.issues });
      }
      context.set('query', result.data);
      return original.call(this, context);
    };
    return descriptor;
  };
}

// ============= Common Schemas =============

/**
 * Common validation schemas
 */
export const schemas = {
  id: z.string().regex(/^\d+$/).transform(Number),
  positiveInt: z.number().int().positive(),
  email: z.string().email(),
  url: z.string().url(),
  uuid: z.string().uuid(),
  date: z.string().datetime(),
  
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
  }),

  sort: z.object({
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  }),
};

/**
 * Create a pagination schema
 */
export function paginationSchema(maxLimit = 100) {
  return z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(maxLimit).default(20),
  });
}
