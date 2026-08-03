import type { ReactNode } from "react";

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

/** Minimal safe inline markdown: **bold**, *italic*, `code`. Rendered as
 * React elements - never HTML - so item text cannot inject markup. */
export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_RE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code key={i} className="rounded bg-neutral-700/60 px-1 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}
