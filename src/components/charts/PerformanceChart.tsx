"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { BasketConfig } from "@/lib/baskets/types";

interface PriceDataPoint {
  timestamp: number;
  prices: Record<string, number>; // mint -> USD price
}

/**
 * Fetch complete basket chart data from server in ONE call.
 * Server uses Pyth Benchmarks (fast, batched) + CoinGecko fallback for non-Pyth tokens.
 * Disk-cached for 24h on server — instant on repeat visits.
 */
async function fetchBasketChart(basketId: string): Promise<PriceDataPoint[]> {
  const res = await fetch(`/api/chart?basket=${encodeURIComponent(basketId)}`);
  if (!res.ok) throw new Error(`Failed to fetch chart: ${res.status}`);
  const json: { data: PriceDataPoint[] } = await res.json();
  return json.data;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateShort(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function PerformanceChart({
  basket,
  weights,
}: {
  basket: BasketConfig;
  weights?: Record<string, number> | null;
}) {
  const [data, setData] = useState<PriceDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBasketChart(basket.id)
      .then((points) => {
        if (!cancelled) {
          setData(points);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to fetch chart:", err);
          setError("Failed to load price data");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [basket.id]);

  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    const activeWeights =
      weights ||
      Object.fromEntries(basket.allocations.map((a) => [a.mint, a.weight]));

    // For each token, find the index of its first non-zero price (launch date)
    const firstValidIndex: Record<string, number> = {};
    for (const alloc of basket.allocations) {
      const idx = data.findIndex((p) => p.prices[alloc.mint] && p.prices[alloc.mint] > 0);
      if (idx !== -1) firstValidIndex[alloc.mint] = idx;
    }

    // Only include tokens that have at least one valid price
    const validAllocs = basket.allocations.filter((a) => firstValidIndex[a.mint] !== undefined);
    const validWeightTotal = validAllocs.reduce(
      (s, a) => s + (activeWeights[a.mint] ?? a.weight),
      0
    );

    return data.map((point, i) => {
      let basketValue = 0;
      for (const alloc of validAllocs) {
        const rawW = activeWeights[alloc.mint] ?? alloc.weight;
        const w = validWeightTotal > 0 ? rawW / validWeightTotal : 1 / validAllocs.length;
        const launchIdx = firstValidIndex[alloc.mint];
        // Before the token launched, treat its contribution as flat (100%)
        if (i < launchIdx) {
          basketValue += 100 * w;
        } else {
          const initialPrice = data[launchIdx].prices[alloc.mint];
          const currentPrice = point.prices[alloc.mint] || initialPrice;
          basketValue += 100 * w * (currentPrice / initialPrice);
        }
      }
      return { timestamp: point.timestamp, value: basketValue };
    });
  }, [data, weights, basket.allocations]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || chartData.length === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const ratio = mouseX / rect.width;
      const idx = Math.round(ratio * (chartData.length - 1));
      setHoverIndex(Math.max(0, Math.min(chartData.length - 1, idx)));
    },
    [chartData]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading historical prices...
        </div>
      </div>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
        {error || "No price data available"}
      </div>
    );
  }

  // Chart bounds
  const values = chartData.map((d) => d.value);
  const minVal = Math.min(...values) * 0.995;
  const maxVal = Math.max(...values) * 1.005;
  const range = maxVal - minVal || 1;

  const displayIndex = hoverIndex ?? chartData.length - 1;
  const currentValue = chartData[displayIndex].value;
  const isPositive = currentValue >= 100;

  const startDate = formatDate(chartData[0].timestamp);
  const endDate = formatDate(chartData[displayIndex].timestamp);

  // SVG dimensions
  const width = 600;
  const height = 140;
  const padTop = 4;
  const padBot = 4;
  const chartH = height - padTop - padBot;

  const getX = (i: number) => (i / (chartData.length - 1)) * width;
  const getY = (val: number) =>
    padTop + chartH - ((val - minVal) / range) * chartH;

  const pathPoints = chartData.map((d, i) => `${getX(i)},${getY(d.value)}`);
  const linePath = `M ${pathPoints.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${padTop + chartH} L 0,${padTop + chartH} Z`;

  // Date labels for below chart — 5 evenly spaced
  const dateLabels: { pct: string; label: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const dataIdx = Math.round((i / 4) * (chartData.length - 1));
    dateLabels.push({
      pct: `${(i / 4) * 100}%`,
      label: formatDateShort(chartData[dataIdx].timestamp),
    });
  }

  // Hover position
  const hoverPct = hoverIndex !== null ? (hoverIndex / (chartData.length - 1)) * 100 : null;
  const hoverX = hoverIndex !== null ? getX(hoverIndex) : null;
  const hoverY = hoverIndex !== null ? getY(chartData[hoverIndex].value) : null;

  // Per-token performance — use each token's first non-zero price as baseline
  const tokenPerf = basket.allocations.map((alloc) => {
    const w = weights?.[alloc.mint] ?? alloc.weight;
    const firstIdx = data.findIndex((p) => p.prices[alloc.mint] && p.prices[alloc.mint] > 0);
    const initialPrice = firstIdx !== -1 ? data[firstIdx].prices[alloc.mint] : undefined;
    const finalPrice = data[data.length - 1]?.prices[alloc.mint];
    const hasData = initialPrice && initialPrice > 0 && finalPrice && finalPrice > 0;
    const change = hasData ? ((finalPrice / initialPrice) - 1) * 100 : null;
    return { symbol: alloc.symbol, weight: w, change };
  });

  return (
    <div className="space-y-3">
      {/* Subheading */}
      <p className="text-sm text-muted-foreground">
        If you would have invested <span className="text-foreground font-medium">$100</span> on{" "}
        <span className="text-foreground font-medium">{startDate}</span>, you would have{" "}
        <span className={`font-bold font-mono ${isPositive ? "text-primary" : "text-red-500"}`}>
          ${currentValue.toFixed(2)}
        </span>{" "}
        on <span className="text-foreground font-medium">{endDate}</span>
      </p>

      {/* Chart container — mouse events on HTML div, not SVG */}
      <div
        ref={containerRef}
        className="w-full relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: "crosshair" }}
      >
        {/* SVG chart — preserveAspectRatio="none" for responsive fill */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-40"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="perfGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? "#54B226" : "#ef4444"} stopOpacity="0.3" />
              <stop offset="100%" stopColor={isPositive ? "#54B226" : "#ef4444"} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#perfGradient)" />
          <path
            d={linePath}
            fill="none"
            stroke={isPositive ? "#54B226" : "#ef4444"}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Hover indicator — rendered as HTML so it doesn't stretch */}
        {hoverPct !== null && hoverX !== null && hoverY !== null && (
          <>
            <div
              className="absolute top-0 bottom-0 w-px"
              style={{
                left: `${hoverPct}%`,
                borderLeft: `1px dashed ${isPositive ? "#54B226" : "#ef4444"}`,
                opacity: 0.6,
              }}
            />
            <div
              className="absolute w-2.5 h-2.5 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                left: `${hoverPct}%`,
                top: `${(hoverY / height) * 100}%`,
                backgroundColor: isPositive ? "#54B226" : "#ef4444",
              }}
            />
          </>
        )}
      </div>

      {/* Date labels — rendered as normal HTML text, not inside SVG */}
      <div className="flex justify-between text-xs text-muted-foreground px-0.5">
        {dateLabels.map((dl, i) => (
          <span key={i}>{dl.label}</span>
        ))}
      </div>

      {/* Per-token breakdown */}
      <div className="flex flex-wrap gap-4 text-xs">
        {tokenPerf.map((t) => (
          <div key={t.symbol} className="flex items-center gap-1">
            <span className="text-muted-foreground">
              {t.symbol} ({t.weight}%)
            </span>
            {t.change === null ? (
              <span className="font-mono text-muted-foreground">N/A</span>
            ) : (
              <span className={`font-mono ${t.change >= 0 ? "text-primary" : "text-red-500"}`}>
                {t.change >= 0 ? "+" : ""}
                {t.change.toFixed(1)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
