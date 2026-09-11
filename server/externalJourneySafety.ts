/**
 * Optional post-registration enrichments must never turn a durable
 * registration into a client-visible failure. Kept dependency-free so this
 * behavior can be unit-tested without importing routing/database modules.
 */
export async function optionalRegistrationEnrichment<T>(work: () => Promise<T>): Promise<
  { available: true; value: T } | { available: false }
> {
  try {
    return { available: true, value: await work() };
  } catch {
    return { available: false };
  }
}