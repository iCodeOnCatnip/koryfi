"use client";

import { useState, useEffect, useCallback } from "react";
import { getTokenPrices } from "@/lib/prices/priceFeed";
import { BASKETS } from "@/lib/baskets/config";

const POLL_INTERVAL = 30_000;

const ALL_MINTS = Array.from(
  new Set(BASKETS.flatMap((b) => b.allocations.map((a) => a.mint)))
);

type PriceSnapshot = {
  prices: Record<string, number>;
  loading: boolean;
};

const subscribers = new Set<(snapshot: PriceSnapshot) => void>();
const activePollingSubscribers = new Set<(snapshot: PriceSnapshot) => void>();
let sharedPrices: Record<string, number> = {};
let sharedLoading = true;
let pollHandle: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

function emit() {
  const snapshot = { prices: sharedPrices, loading: sharedLoading };
  for (const sub of subscribers) sub(snapshot);
}

async function refreshPrices(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const nextPrices = await getTokenPrices(ALL_MINTS);
      if (Object.keys(nextPrices).length > 0 || Object.keys(sharedPrices).length === 0) {
        sharedPrices = nextPrices;
      }
    } catch (err) {
      console.error("Failed to fetch prices:", err);
    } finally {
      sharedLoading = false;
      emit();
      inFlight = null;
    }
  })();

  return inFlight;
}

function ensurePolling() {
  if (pollHandle) return;
  void refreshPrices();
  pollHandle = setInterval(() => {
    void refreshPrices();
  }, POLL_INTERVAL);
}

function maybeStopPolling() {
  if (activePollingSubscribers.size > 0 || !pollHandle) return;
  clearInterval(pollHandle);
  pollHandle = null;
}

function syncPollingState() {
  if (activePollingSubscribers.size > 0) {
    ensurePolling();
    return;
  }
  maybeStopPolling();
}

export function usePrices({ paused = false }: { paused?: boolean } = {}) {
  const [snapshot, setSnapshot] = useState<PriceSnapshot>({
    prices: sharedPrices,
    loading: sharedLoading,
  });

  useEffect(() => {
    subscribers.add(setSnapshot);
    if (!paused) activePollingSubscribers.add(setSnapshot);
    syncPollingState();

    return () => {
      subscribers.delete(setSnapshot);
      activePollingSubscribers.delete(setSnapshot);
      maybeStopPolling();
    };
  }, [paused]);

  const refetch = useCallback(async () => {
    await refreshPrices();
  }, []);

  return { prices: snapshot.prices, loading: snapshot.loading, refetch };
}
