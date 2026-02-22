"use client";

import { useRouter } from "next/navigation";

export function TourLink() {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        try { sessionStorage.setItem("openTour", "1"); } catch { /* private browsing */ }
        router.push("/baskets");
      }}
      className="text-lg md:text-xl font-normal text-foreground hover:text-primary transition-colors active:scale-[0.97] active:brightness-90 whitespace-nowrap cursor-pointer"
    >
      Take a tour →
    </button>
  );
}
