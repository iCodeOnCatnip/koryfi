"use client";

import { TokenAllocation } from "@/lib/baskets/types";

// Green-based color palette with good contrast between segments
const COLORS = [
  "bg-emerald-500",
  "bg-green-400",
  "bg-teal-500",
  "bg-lime-500",
  "bg-cyan-600",
];

export function AllocationBar({
  allocations,
  weights,
}: {
  allocations: TokenAllocation[];
  weights?: Record<string, number>;
}) {
  // Sort by weight descending so largest segment is first
  const sorted = [...allocations].sort((a, b) => {
    const wA = weights?.[a.mint] ?? a.weight;
    const wB = weights?.[b.mint] ?? b.weight;
    return wB - wA;
  });

  return (
    <div className="w-full">
      <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5">
        {sorted.map((alloc, i) => {
          const w = weights?.[alloc.mint] ?? alloc.weight;
          return (
            <div
              key={alloc.mint}
              className={`${COLORS[i % COLORS.length]} transition-all duration-300`}
              style={{ width: `${w}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-xs text-muted-foreground">
        {sorted.map((alloc, i) => {
          const w = weights?.[alloc.mint] ?? alloc.weight;
          return (
            <div key={alloc.mint} className="flex items-center gap-1">
              <div
                className={`w-2 h-2 rounded-full ${COLORS[i % COLORS.length]}`}
              />
              <span>
                {alloc.symbol} {w}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
