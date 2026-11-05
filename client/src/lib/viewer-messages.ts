const CHECKOUT_FALLBACK = "目前無法開啟付款頁，請稍後再試，或聯絡主辦單位。";

/**
 * Turns a checkout failure into a sentence a viewer can read. Server and
 * provider errors arrive as English text or "400: {json}"; only a message
 * already written in Chinese is passed through.
 */
export function viewerCheckoutError(error: unknown): string {
  let text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  text = text.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.message === "string") text = parsed.message;
  } catch {
    // Not JSON: keep the text as it is.
  }
  return /[一-鿿]/.test(text) ? text : CHECKOUT_FALLBACK;
}
