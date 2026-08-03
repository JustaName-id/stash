import type { ItemKind } from "../types";

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

export function detectKind(text: string): ItemKind {
  return URL_RE.test(text.trim()) ? "link" : "text";
}
