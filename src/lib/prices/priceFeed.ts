/**
 * Client-side price fetching — proxies through /api/prices to keep API keys server-side.
 */
export async function getTokenPrices(
  mintAddresses: string[]
): Promise<Record<string, number>> {
  if (mintAddresses.length === 0) return {};

  const res = await fetch(`/api/prices?mints=${mintAddresses.join(",")}`);
  if (!res.ok) return {};

  const data: { prices: Record<string, number> } = await res.json();
  return data.prices ?? {};
}
