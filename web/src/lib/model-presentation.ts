// OpenCode model ids identify the transport route; display the model separately.
export function openCodeModelPresentation(id: string) {
  const segments = id.split("/").filter(Boolean);
  const raw = segments.at(-1) ?? id;
  const vendor = segments[0]?.toLowerCase();
  const names: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", google: "Google", xai: "xAI" };
  const vendors = new Set(["anthropic", "deepseek", "google", "meta", "mistral", "moonshotai", "nvidia", "openai", "qwen", "xai"]);
  const isFree = id.toLowerCase().endsWith("-free") || id.toLowerCase() === "opencode/big-pickle";
  const name = raw.replace(/[-_]free$/i, "").replace(/[-_]+/g, " ").trim().split(/\s+/).map((part) => {
    if (/^(gpt|glm)$/i.test(part) || /^v\d/i.test(part)) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(" ");
  const vendorName = vendor && vendors.has(vendor) ? (names[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1)) : null;
  return { name, description: vendorName ? `${vendorName} by OpenCode` : "OpenCode", isFree };
}
