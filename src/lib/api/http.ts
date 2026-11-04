import { NextResponse } from "next/server";
import { z } from "zod";
import { AIConfigurationError, AIResponseError } from "@/lib/ai/types";
import { ValidationError } from "@/lib/ingestion/validation";
import { logger } from "@/lib/logger";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RateLimitError extends HttpError {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(429, message, "rate_limited");
  }
}

export const unauthorized = () => new HttpError(401, "You need to sign in to do that.", "unauthorized");
export const notFound = (what = "Resource") => new HttpError(404, `${what} not found.`, "not_found");

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** Maps known errors to safe HTTP responses; unknown errors are logged, not leaked. */
export function errorResponse(error: unknown, context?: string) {
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
    );
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message, code: "invalid_request" }, { status: 400 });
  }
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid request.", code: "invalid_request" },
      { status: 400 },
    );
  }
  if (error instanceof AIConfigurationError) {
    return NextResponse.json({ error: error.message, code: "ai_not_configured" }, { status: 503 });
  }
  if (error instanceof AIResponseError) {
    logger.warn("ai.response_error", { context, message: error.message });
    return NextResponse.json({ error: error.message, code: "ai_error" }, { status: 502 });
  }
  logger.error("api.unhandled", { context, error: error instanceof Error ? error.message : String(error) });
  return NextResponse.json({ error: "Something went wrong. Please try again.", code: "internal" }, { status: 500 });
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  return schema.parse(body);
}

export const uuidSchema = z.string().uuid();

export function parseId(value: string, what = "Resource"): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw notFound(what);
  return result.data;
}
