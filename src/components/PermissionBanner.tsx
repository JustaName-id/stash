import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function PermissionBanner() {
  const [trusted, setTrusted] = useState(true);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const check = () =>
      invoke<boolean>("is_accessibility_trusted")
        .then(setTrusted)
        .catch((err) => console.error("accessibility check failed", err));
    check();
    timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, []);

  if (trusted) return null;

  return (
    <div className="mx-3 mb-2 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
      <p className="mb-1.5">
        Stash needs Accessibility permission for the double-Shift shortcut.
      </p>
      <button
        onClick={() => invoke("prompt_accessibility")}
        className="cursor-pointer rounded-md bg-amber-700/60 px-2 py-1 font-medium text-amber-50 hover:bg-amber-700"
      >
        Open System Settings
      </button>
      <p className="mt-1.5 text-amber-200/60">
        The shortcut activates a few seconds after granting. If it doesn't,
        quit and reopen Stash.
      </p>
    </div>
  );
}
