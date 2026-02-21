"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/wallet/ConnectButton";

export function HeaderNav() {
  const pathname = usePathname();
  const isLanding = pathname === "/landing";

  if (isLanding) {
    return (
      <div className="flex items-center">
        <Button asChild size="sm" className="h-9 px-4">
          <Link href="/baskets">Check out the app</Link>
        </Button>
      </div>
    );
  }

  return (
    <nav className="flex items-center gap-6">
      <Link href="/baskets" className="nav-link">Baskets</Link>
      <Link href="/dashboard" className="nav-link">Dashboard</Link>
      <ConnectButton />
    </nav>
  );
}
