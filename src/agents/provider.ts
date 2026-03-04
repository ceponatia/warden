export type AiProvider = "openai" | "anthropic" | "github";

export interface ProviderConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

export interface ProviderCallOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export function resolveProviderConfig(): ProviderConfig {
  const rawProvider = process.env["WARDEN_AI_PROVIDER"] ?? "github";
  if (
    rawProvider !== "openai" &&
    rawProvider !== "anthropic" &&
    rawProvider !== "github"
  ) {
    throw new Error(
      `Unsupported WARDEN_AI_PROVIDER: ${rawProvider}. Must be "openai", "anthropic", or "github".`,
    );
  }

  const provider: AiProvider = rawProvider;

  if (provider === "openai") {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for the openai provider.",
      );
    }
    const model = process.env["WARDEN_AI_MODEL"] ?? "gpt-5.3-codex";
    return { provider, model, apiKey };
  }

  if (provider === "anthropic") {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for the anthropic provider.",
      );
    }
    const model = process.env["WARDEN_AI_MODEL"] ?? "claude-4-6-opus";
    return { provider, model, apiKey };
  }

  // GitHub Models provider (Pro tier)
  const apiKey = process.env["GITHUB_TOKEN"] ?? process.env["WARDEN_GITHUB_TOKEN"];
  if (!apiKey) {
    throw new Error(
      "GITHUB_TOKEN or WARDEN_GITHUB_TOKEN is required for the github provider.",
    );
  }
  const model = process.env["WARDEN_AI_MODEL"] ?? "gpt-5.3-codex";
  return { provider, model, apiKey };
}

async function callOpenAi(
  config: ProviderConfig,
  options: ProviderCallOptions,
): Promise<string> {
  const body = JSON.stringify({
    model: config.model,
    max_tokens: options.maxTokens ?? 2048,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ],
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message.content;
  if (!content) {
    throw new Error("OpenAI API returned no content.");
  }
  return content;
}

async function callGithubModels(
  config: ProviderConfig,
  options: ProviderCallOptions,
): Promise<string> {
  const body = JSON.stringify({
    model: config.model,
    max_tokens: options.maxTokens ?? 2048,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ],
  });

  // Use the GitHub Models inference endpoint
  const response = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub Models API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message.content;
  if (!content) {
    throw new Error("GitHub Models API returned no content.");
  }
  return content;
}

async function callAnthropic(
  config: ProviderConfig,
  options: ProviderCallOptions,
): Promise<string> {
  const body = JSON.stringify({
    model: config.model,
    max_tokens: options.maxTokens ?? 2048,
    system: options.systemPrompt,
    messages: [{ role: "user", content: options.userPrompt }],
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const block = data.content.find((item) => item.type === "text");
  if (!block) {
    throw new Error("Anthropic API returned no text content.");
  }
  return block.text;
}

export async function callProvider(
  options: ProviderCallOptions,
): Promise<string> {
  const config = resolveProviderConfig();
  if (config.provider === "openai") {
    return callOpenAi(config, options);
  }
  if (config.provider === "github") {
    return callGithubModels(config, options);
  }
  return callAnthropic(config, options);
}
