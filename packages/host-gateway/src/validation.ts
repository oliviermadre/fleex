/**
 * Runtime shape validation for gateway request bodies.
 *
 * `/exec` and `/fs` accept arbitrary JSON from the network. Casting
 * `await req.json()` to the handler's parameter type would silence the
 * compiler while leaving the handlers free to run on malformed input, so
 * every field is checked at runtime before it reaches a handler.
 */

/** Thrown when a request body fails validation. The router maps it to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`"${field}" must be a string`);
  }
  return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireString(value, field);
}

export function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`"${field}" must be a finite number`);
  }
  return value;
}

export function optionalNumber(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requireNumber(value, field);
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new ValidationError(`"${field}" must be a boolean`);
  }
  return value;
}

export function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(`"${field}" must be an array of strings`);
  }
  return value.map((item, i) => requireString(item, `${field}[${i}]`));
}
