import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TourCarousel } from "@/components/TourCarousel";
import { TourLink } from "@/components/TourLink";
import { CursorTrail } from "@/components/home/CursorTrail";

export default function HomePage() {
  return (
    <>
      <CursorTrail />
      {/* Keep homepage locked to one viewport without page scroll */}
      <style>{`html, body { overflow: hidden; }`}</style>

      <div className="max-w-6xl mx-auto h-[calc(100dvh-8.5rem)] -mb-8 overflow-hidden flex flex-col">
        <section className="pt-[clamp(0.75rem,2.5vh,2rem)] shrink-0">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-[53px] md:text-[65px] lg:text-[77px] font-semibold leading-[1.05] tracking-tight text-foreground">
              <span className="block md:whitespace-nowrap">One-click invest in</span>
              <span className="block md:whitespace-nowrap">crypto indices</span>
            </h1>

            <div className="mt-[clamp(0.85rem,2vh,1.5rem)] mx-auto max-w-3xl">
              <p className="text-xs sm:text-sm md:text-base lg:text-[17px] leading-snug text-center text-foreground/70 whitespace-nowrap">
                KoryFi let&apos;s you build your ideal crypto portfolio in one click with{" "}
                <span className="relative inline-flex items-center group">
                  <span className="underline decoration-1 underline-offset-4 decoration-primary/70 text-primary cursor-help">self-custodial</span>
                  <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-primary/30 bg-card px-3 py-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    Assets go straight to your wallet.{" "}
                    <span className="font-bold text-white">Your keys, your coins.</span>
                  </span>
                </span>{" "}
                <span className="text-foreground">funds</span>
              </p>
            </div>

            <div className="mt-[clamp(1rem,2.75vh,2rem)] flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                asChild
                size="lg"
                className="h-10 px-5 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_0_1px_rgba(0,196,140,0.35)]"
              >
                <Link href="/baskets">Invest in 28 seconds</Link>
              </Button>

              <TourLink />
            </div>
          </div>
        </section>

        <section id="tour" className="mt-[clamp(0.65rem,2vh,1.5rem)] flex-1 min-h-0">
          <div className="relative h-full aspect-[2/1] max-w-full mx-auto overflow-hidden rounded-3xl border border-border/80 bg-card/60 backdrop-blur-[14px] shadow-[0_0_0_1px_rgba(0,196,140,0.08),0_20px_50px_rgba(0,0,0,0.35)]">
            <TourCarousel />
          </div>
        </section>
      </div>
    </>
  );
}
