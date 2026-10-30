// Adapted from Orca, Copyright (c) 2026 Lovecast Inc. MIT — see THIRD_PARTY_NOTICES.md.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["2xs", "3xs", "chat-code"] } },
});
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
