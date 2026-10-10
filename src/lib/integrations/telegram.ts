import "server-only";

/** Sends an HTML message to the team chat. No-op until TELEGRAM_* env vars are set. */
export async function notifyTeam(html: string, chatId = process.env.TELEGRAM_CHAT_ID) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { skipped: true as const };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("Telegram sendMessage failed", res.status, await res.text());
  return { skipped: false as const, ok: res.ok };
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
