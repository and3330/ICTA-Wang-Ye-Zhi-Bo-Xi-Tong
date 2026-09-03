const DEFAULT_ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const REQUEST_TIMEOUT_MS = 90_000;

type ChatMessageContent = string | Array<{ type?: string; text?: string }>;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: ChatMessageContent;
    };
  }>;
  error?: { message?: string };
};

function requiredConfig() {
  const apiKey = process.env.ARK_API_KEY?.trim();
  const model = process.env.ARK_MODEL?.trim();
  const baseUrl = (process.env.ARK_BASE_URL?.trim() || DEFAULT_ARK_BASE_URL).replace(/\/+$/, "");
  if (!apiKey) throw new Error("BytePlus ARK_API_KEY is not configured");
  if (!model) throw new Error("BytePlus ARK_MODEL is not configured");
  if (!/^https:\/\/ark\.ap-southeast\.bytepluses\.com\/api\/v3$/i.test(baseUrl)) {
    throw new Error("BytePlus ARK_BASE_URL is not an approved ModelArk endpoint");
  }
  return { apiKey, model, baseUrl };
}

function messageText(content: ChatMessageContent | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export async function callBytePlusJson(system: string, user: string, maxTokens = 4096): Promise<string> {
  const { apiKey, model, baseUrl } = requiredConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.json().catch(() => null) as ChatCompletionResponse | null;
  if (!response.ok) {
    const providerMessage = body?.error?.message?.trim();
    throw new Error(`BytePlus request failed (${response.status})${providerMessage ? `: ${providerMessage}` : ""}`);
  }
  const content = messageText(body?.choices?.[0]?.message?.content);
  if (!content.trim()) throw new Error("BytePlus returned an empty response");
  return content;
}