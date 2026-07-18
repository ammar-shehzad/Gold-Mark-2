/** Renders a `{{token}}` template body against a flat vars map. Missing tokens render as empty string. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}
