"use client";

import { useRouter } from "next/navigation";
import { BasketConfig } from "@/lib/baskets/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function BasketCard({
  basket,
}: {
  basket: BasketConfig;
}) {
  const router = useRouter();

  return (
    <Card
      className="h-full flex flex-col bg-card"
      style={{
        border: "1px solid rgba(0,196,140,0.35)",
        borderRadius: "14px",
      }}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold" style={{ color: "#E6F2ED" }}>
          {basket.name}
        </CardTitle>
        <p className="text-sm" style={{ color: "#9FB8AD" }}>
          {basket.description}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 flex-1">
        {/* Assets list */}
        <div className="flex-1">
          <span className="text-xs" style={{ color: "#9FB8AD" }}>
            Assets in this fund
          </span>
          {(() => {
            const allocs = basket.allocations;
            const cols = Math.ceil(allocs.length / 4);
            const columns: typeof allocs[] = [];
            for (let c = 0; c < cols; c++) {
              columns.push(allocs.slice(c * 4, c * 4 + 4));
            }
            return (
              <div className="flex gap-6 mt-2">
                {columns.map((col, ci) => (
                  <div key={ci} className="flex flex-col gap-2 flex-1">
                    {col.map((alloc) => (
                      <div key={alloc.mint} className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={alloc.icon}
                          alt={alloc.symbol}
                          className="w-5 h-5 rounded-full"
                          style={{ background: "#fff" }}
                        />
                        <span className="text-sm font-medium" style={{ color: "#E6F2ED" }}>
                          {alloc.symbol}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Deposit CTA */}
        <button
          onClick={() => router.push(`/basket/${basket.id}`)}
          className="w-full mt-auto rounded-md text-sm font-medium py-2 px-4 transition-all duration-200 cursor-pointer"
          style={{
            background: "transparent",
            border: "1px solid #1F2A22",
            color: "#E6F2ED",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = "#00C48C";
            el.style.color = "#00C48C";
            el.style.boxShadow = "0 0 0 1px rgba(0,196,140,0.4)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = "#1F2A22";
            el.style.color = "#E6F2ED";
            el.style.boxShadow = "none";
          }}
        >
          Explore
        </button>
      </CardContent>
    </Card>
  );
}
