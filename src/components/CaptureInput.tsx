import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStashStore } from "../store";

export function CaptureInput() {
  const add = useStashStore((s) => s.add);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const unlisten = listen("panel-shown", () => inputRef.current?.focus());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const submit = () => {
    add(value);
    setValue("");
  };

  return (
    <div className="px-3 pt-2 pb-3">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder="Add a note or a prompt… (# Name creates a section)"
        aria-label="Capture a prompt, link, or idea"
        className="w-full resize-none rounded-lg border border-neutral-700/80 bg-neutral-800/80 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-amber-600/70 focus:outline-none"
      />
    </div>
  );
}
