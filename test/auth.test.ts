import { describe, expect, it } from "vitest";
import { tenantFromRequest } from "../src/auth";
import type { Env } from "../src/types";

const env = (tokens: string): Env =>
  ({ TENANT_TOKENS: tokens, AI: {} as never, INDEX: {} as never }) as unknown as Env;

const req = (headers: Record<string, string> = {}, body?: unknown) =>
  new Request("https://example.com/query", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const tokens = '{"tok_acme":"acme","tok_globex":"globex"}';

describe("tenantFromRequest", () => {
  it("maps a known token to its tenant", () => {
    expect(tenantFromRequest(req({ authorization: "Bearer tok_acme" }), env(tokens))).toBe("acme");
  });

  it("rejects an unknown token", () => {
    expect(tenantFromRequest(req({ authorization: "Bearer nope" }), env(tokens))).toBeNull();
  });

  it("rejects a missing header", () => {
    expect(tenantFromRequest(req(), env(tokens))).toBeNull();
  });

  it("ignores a tenant supplied in the body, which is the whole point", async () => {
    const request = req({ authorization: "Bearer tok_acme" }, { tenant: "globex" });

    expect(tenantFromRequest(request, env(tokens))).toBe("acme");
    // The body is still readable, it just has no say in who you are.
    expect(await request.json()).toEqual({ tenant: "globex" });
  });

  it("fails closed when the secret is malformed instead of defaulting to a tenant", () => {
    expect(tenantFromRequest(req({ authorization: "Bearer tok_acme" }), env("{not json"))).toBeNull();
  });

  it("does not accept a bare token without the Bearer scheme", () => {
    expect(tenantFromRequest(req({ authorization: "tok_acme" }), env(tokens))).toBeNull();
  });
});
