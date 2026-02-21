"use client";

import { useState, useEffect, useCallback } from "react";
import { getTokenPrices } from "@/lib/prices/priceFeed";
import { BASKETS } from "@/lib/baskets/config";

const POLL_INTERVAL = 30_000; // 30s - Pyth is real-time, CoinGecko fallback cached 2 min server-side

export function usePrices() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const allMints = Array.from(
    new Set(BASKETS.flatMap((b) => b.allocations.map((a) => a.mint)))
  );

  const fetchPrices = useCallback(async () => {
    try {
      const p = await getTokenPrices(allMints);
      setPrices(p);
    } catch (err) {
      console.error("Failed to fetch prices:", err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  return { prices, loading, refetch: fetchPrices };
}
