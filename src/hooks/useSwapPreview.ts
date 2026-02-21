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
  inputMint?: string
) {
  const [preview, setPreview] = useState<SwapPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!basket || amount <= 0) {
      setPreview(null);
      return;
    }

    let cancelled = false;

    const fetchQuote = async () => {
      setLoading(true);
      setError(null);
      try {
        const p = await getSwapPreview(
          basket,
          amount,
          customWeights,
          slippageBps,
          inputMint
        );
        if (!cancelled) {
          setPreview(p);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to get quote");
          setPreview(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    // Fetch immediately once
    fetchQuote();

    // Then poll every 4 seconds for UI updates
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchQuote, 4000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [basket, amount, customWeights, slippageBps, inputMint]);

  return { preview, loading, error };
}
