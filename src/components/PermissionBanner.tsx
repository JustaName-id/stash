import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PermissionStatus {
  accessibility: boolean;
  input_monitoring: boolean;
}

export function PermissionBanner() {
  const [status, setStatus] = useState<PermissionStatus | null>(null);

  useEffect(() => {
    const check = () =>
      invoke<PermissionStatus>("permission_status")
        .then(setStatus)
        .catch((err) => console.error("permission check failed", err));
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, []);

  if (!status || (status.accessibility && status.input_monitoring)) return null;

  return (
    <div className="mx-3 mb-2 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
      <p className="mb-1">
        The double-Shift shortcut needs permissions in Privacy &amp; Security:
      </p>
      <p className="mb-1.5 font-medium">
        {status.input_monitoring ? "✓" : "✗"} Input Monitoring
        <span className="mx-2 text-amber-200/40">·</span>
        {status.accessibility ? "✓" : "✗"} Accessibility
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => invoke("prompt_accessibility")}
          className="cursor-pointer rounded-md bg-amber-700/60 px-2 py-1 font-medium text-amber-50 hover:bg-amber-700"
        >
          Open System Settings
        </button>
        <button
          onClick={() => invoke("restart_app")}
          className="cursor-pointer rounded-md bg-amber-900/60 px-2 py-1 font-medium text-amber-100 hover:bg-amber-800"
        >
          Restart Stash
        </button>
      </div>
      <p className="mt-1.5 text-amber-200/60">
        Input Monitoring usually applies after a restart — grant both, then
        hit Restart.
      </p>
    </div>
  );
}
