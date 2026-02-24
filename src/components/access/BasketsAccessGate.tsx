"use client";

import { useEffect, useState } from "react";

const FINGERPRINT_KEY = "koryfi_access_fingerprint_v1";

function getOrCreateFingerprint(): string {
  const existing = localStorage.getItem(FINGERPRINT_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(FINGERPRINT_KEY, id);
  return id;
}

export function BasketsAccessGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const fingerprint = getOrCreateFingerprint();
        const res = await fetch("/api/access/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint }),
        });
        const data = (await res.json()) as { allowed?: boolean };
        if (!active) return;
        setAllowed(Boolean(data.allowed));
      } catch {
        if (!active) return;
        setError("Unable to verify access right now.");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleUnlock() {
    setLoading(true);
    setError(null);
    try {
      const fingerprint = getOrCreateFingerprint();
      const res = await fetch("/api/access/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, fingerprint }),
      });
      const data = (await res.json()) as { allowed?: boolean; error?: string };
      if (!res.ok || !data.allowed) {
        setError(data.error ?? "Invalid code");
        return;
      }
      setAllowed(true);
      setCode("");
    } catch {
      setError("Could not redeem code. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {children}
      {ready && !allowed && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-6 shadow-2xl">
            <h3 className="text-xl font-semibold mb-2">Private Access</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Enter an access code. Each code can be used on only one device/browser.
            </p>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Enter access code"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />

            {error && <p className="text-xs text-destructive mt-2">{error}</p>}

            <button
              type="button"
              onClick={handleUnlock}
              disabled={loading || !code.trim()}
              className="mt-4 w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Checking..." : "Unlock Baskets"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
