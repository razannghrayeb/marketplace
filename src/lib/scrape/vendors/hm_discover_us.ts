export async function discoverHmProductUrlsBySearch(opts: {
  query: string;
  maxPages: number;
  delayMs?: number;
  locale?: string;
}): Promise<string[]> {
  // Stub implementation: H&M vendor scraping not available in this build.
  // Returns an empty list so the worker can compile and run without H&M support.
  return [];
}
