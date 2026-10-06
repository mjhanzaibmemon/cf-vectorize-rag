import type { Env } from "./types";

/**
 * Resolve the tenant from the bearer token.
 *
 * The important property is what this function does not accept: a tenant id
 * from the request body or a header the caller controls. Every multi-tenant
 * leak I have seen started with someone trusting the client to say who they
 * are. The token maps to a tenant on the server or the request is rejected.
 */
export function tenantFromRequest(request: Request, env: Env): string | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length === 0) return null;

  let map: Record<string, string>;
  try {
    map = JSON.parse(env.TENANT_TOKENS || "{}");
  } catch {
    // A malformed secret must fail closed, not fall back to a default tenant.
    return null;
  }

  return map[token] ?? null;
}
