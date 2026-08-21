import "server-only";

/**
 * The model seam for Analyst Insight — portal-owned orchestration.
 *
 * A plain fetch against the Messages API (AI Gateway preferred, direct
 * Anthropic fallback), one forced tool call for structured output. No SDK.
 *
 * Two hard properties, in the estate's spirit:
 *   1. NOT-CONFIGURED IS A FIRST-CLASS STATE — with no key, the portal renders
 *      the missing variable by name. It never falls back to canned prose.
 *   2. THE MODEL RECEIVES ONLY THE STRUCTURED CONTEXT. It interprets canonical
 *      states; it does not discover data. The grounding firewall in
 *      validate.ts enforces that independently of whether instructions are obeyed.
 */

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  auth: "bearer" | "x-api-key";
};

export type LlmAvailability = { ok: true; config: LlmConfig } | { ok: false; reason: string };

export function llmAvailability(): LlmAvailability {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const gatewayBase = process.env.AI_GATEWAY_BASE_URL;
  const model = process.env.INSIGHT_MODEL ?? "claude-sonnet-5";

  if (anthropicKey) {
    return {
      ok: true,
      config: { apiKey: anthropicKey, baseUrl: "https://api.anthropic.com", model, auth: "x-api-key" },
    };
  }
  // The gateway path is used only when its base URL is EXPLICITLY configured —
  // a guessed endpoint that 404s would read as a broken product. Verified
  // 2026-08-21: the previously assumed default path does not exist.
  if (gatewayKey && gatewayBase) {
    return { ok: true, config: { apiKey: gatewayKey, baseUrl: gatewayBase, model, auth: "bearer" } };
  }
  if (gatewayKey && !gatewayBase) {
    return {
      ok: false,
      reason:
        "AI_GATEWAY_API_KEY is set but AI_GATEWAY_BASE_URL is not. Set the gateway's Anthropic-compatible " +
        "base URL from your Vercel AI Gateway settings, or set ANTHROPIC_API_KEY instead.",
    };
  }
  return {
    ok: false,
    reason:
      "No model configured. Set ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY plus AI_GATEWAY_BASE_URL) in " +
      ".env.local. Until then the portal computes every canonical state but writes no Analyst Insight.",
  };
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** One forced tool call returning the validated object, or a stated failure. */
export async function generateStructured<T>(
  config: LlmConfig,
  args: { system: string; user: string; tool: ToolSchema; maxTokens?: number },
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (config.auth === "bearer") headers.authorization = `Bearer ${config.apiKey}`;
  else headers["x-api-key"] = config.apiKey;

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        max_tokens: args.maxTokens ?? 900,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
        tools: [args.tool],
        tool_choice: { type: "tool", name: args.tool.name },
      }),
    });
  } catch (e) {
    return { ok: false, reason: `Model call failed: ${(e as Error).message}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, reason: `Model returned ${res.status}. ${body.slice(0, 200)}` };
  }

  let payload: { content?: Array<{ type: string; name?: string; input?: unknown }> };
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: "Model returned a non-JSON body." };
  }

  const call = payload.content?.find((c) => c.type === "tool_use" && c.name === args.tool.name);
  if (!call?.input) return { ok: false, reason: "Model did not return the requested structured output." };
  return { ok: true, value: call.input as T };
}
