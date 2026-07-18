// Mirrors whatsapp-bot/src/template.ts — no shared package exists between
// the Next app and the bot, so this tiny helper is intentionally duplicated.

/** Renders a `{{token}}` template body against a flat vars map. Missing tokens render as empty string. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}
