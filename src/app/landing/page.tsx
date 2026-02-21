import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <>
      {/* Lock scroll on this page only */}
      <style>{`html, body { overflow: hidden; }`}</style>

      {/*
        Height: 100vh minus header (4rem) minus main top padding only (2rem).
        -mb-8 pulls the div down to cover main's bottom padding so the card
        reaches the very bottom of the viewport.
      */}
      <div className="max-w-6xl mx-auto h-[calc(100vh-6rem)] -mb-8 overflow-hidden flex flex-col">
        <section className="pt-2 md:pt-4 shrink-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-28 items-start">
            <div className="lg:justify-self-start lg:pr-8">
              <h1
                className="text-4xl md:text-5xl lg:text-6xl font-semibold leading-[1.1] tracking-tight text-foreground"
              >
                <span className="block md:whitespace-nowrap">One-click invest in</span>
                <span className="block md:whitespace-nowrap">crypto indices</span>
              </h1>

              <div className="mt-7 flex flex-col sm:flex-row sm:items-center gap-4">
                <Button
                  asChild
                  size="lg"
                  className="h-10 px-5 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_0_1px_rgba(0,196,140,0.35)]"
                >
                  <Link href="/baskets">Invest in 28 seconds</Link>
                </Button>

                <Link
                  href="#tour"
                  scroll={false}
                  className="text-lg md:text-xl font-normal text-foreground hover:text-primary transition-colors active:scale-[0.97] active:brightness-90 whitespace-nowrap"
                >
                  Take a tour →
                </Link>
              </div>
            </div>

          <div className="lg:justify-self-end lg:self-start lg:pl-8">
            <p className="text-[20px] leading-snug">
              <span className="block text-foreground/70">KoryFi let&apos;s you build your ideal</span>
              <span className="block text-foreground/70">crypto portfolio in one click with</span>
              <span className="block text-[20px] leading-snug mt-1">
                <span className="relative inline-flex items-center group">
                  <span className="underline decoration-1 underline-offset-4 decoration-primary/70 text-primary cursor-help">self-custodial</span>
                  <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-primary/30 bg-card px-3 py-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    Assets go straight to your wallet.{" "}
                    <span className="font-bold text-white">Your keys, your coins.</span>
                  </span>
                </span>{" "}
                <span className="text-foreground">funds</span>
              </span>
              </p>
              <p className="text-[24px] text-foreground leading-snug mt-5">
                Crypto isn&apos;t easy, <span className="text-primary">KoryFi</span> is.
              </p>
            </div>
          </div>
        </section>

        <section id="tour" className="mt-8 md:mt-10 flex-1 min-h-0">
          {/*
            rounded-b-none so the card merges flush with the viewport bottom
            (the -mb-8 on the outer div handles the physical positioning).
          */}
          <div className="relative w-full max-w-[900px] mx-auto h-full overflow-hidden rounded-t-2xl rounded-b-none border border-b-0 border-primary/20 bg-card shadow-[0_0_0_1px_rgba(0,196,140,0.08)]">
            {/* Top bar — traffic lights left, label centered */}
            <div className="absolute top-0 left-0 right-0 flex items-center px-4 h-10 border-b border-primary/10 pointer-events-none">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              </div>
              <div className="absolute left-0 right-0 flex flex-col items-center gap-0.5">
                <p className="text-xs uppercase tracking-widest text-muted-foreground/60">Product tour</p>
                <p className="text-[11px] text-muted-foreground/40">Basket selection → one-click invest → confirmation</p>
              </div>
            </div>

            {/* App screenshot placeholder — replace with <img> when ready */}
            <div className="absolute bottom-0 left-0 right-0 h-[280px] md:h-[320px] flex items-center justify-center text-muted-foreground/30 text-sm">
              App screenshots go here
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
