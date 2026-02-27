"use client";

import { useState, useEffect, useRef } from "react";
import { BasketConfig } from "@/lib/baskets/types";
import { getSwapPreview, SwapPreview } from "@/lib/swap/swapExecutor";
import { DEFAULT_SLIPPAGE_BPS } from "@/lib/constants";

export function useSwapPreview(
  basket: BasketConfig | null,
  amount: number,
  customWeights: Record<string, number> | null,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
  inputMint?: string,
  refreshKey: number = 0,
  enabled: boolean = true,
  pollMs: number = 0
) {
  const [preview, setPreview] = useState<SwapPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      return;
    }

    if (!basket || amount <= 0) {
      setPreview(null);
      setError(null);
      setLoading(false);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      return;
    }

    seqRef.current += 1;
    const currentSeq = seqRef.current;
    let cancelled = false;

    const fetchQuote = async (attempt = 0) => {
      if (cancelled || currentSeq !== seqRef.current) return;
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      if (attempt === 0) setError(null);
      try {
        const p = await getSwapPreview(
          basket,
          amount,
          customWeights,
          slippageBps,
          inputMint,
          controller.signal
        );
        if (!cancelled && currentSeq === seqRef.current) {
          setPreview(p);
          setError(null);
        }
      } catch (err) {
        if (cancelled || currentSeq !== seqRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "Failed to get quote";
        if (/aborted|aborterror|canceled|cancelled/i.test(message)) return;
        const rateLimited = /rate limit|429|too many requests/i.test(message);
        if (rateLimited && attempt < 2) {
          const backoffMs = attempt === 0 ? 900 : 1700;
          if (retryRef.current) clearTimeout(retryRef.current);
          retryRef.current = setTimeout(() => {
            void fetchQuote(attempt + 1);
          }, backoffMs);
          return;
        }
        if (!cancelled && currentSeq === seqRef.current) {
          setError(message);
          setPreview(null);
        }
      } finally {
        if (!cancelled && currentSeq === seqRef.current) {
          setLoading(false);
        }
      }
    };

    // Debounce rapid input churn to reduce quote spam.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchQuote(0);
    }, 350);

    if (pollRef.current) clearInterval(pollRef.current);
    if (pollMs > 0) {
      pollRef.current = setInterval(() => {
        void fetchQuote(0);
      }, pollMs);
    }

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [basket, amount, customWeights, slippageBps, inputMint, refreshKey, enabled, pollMs]);

  return { preview, loading, error };
}
