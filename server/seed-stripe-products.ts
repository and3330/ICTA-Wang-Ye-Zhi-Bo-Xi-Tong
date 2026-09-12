import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";
import {
  ADDON_LOOKUP_KEY,
  ANNUAL_ADDON_LOOKUP_KEY,
  STARTER_LEGACY_LOOKUP_KEYS,
  STARTER_NEW_FALLBACK_LOOKUP_KEYS,
  STARTER_NEW_LOOKUP_KEYS,
} from "./subscriptionEntitlements";

type CatalogItem = {
  key: "starter" | "growth" | "scale" | "addon";
  name: string;
  description: string;
  amount: number;
  lookupKey: string;
  fallbackLookupKey?: string;
  interval: "month" | "year";
  capacity: string;
  registrants?: string;
  priceVersion?: string;
};

/**
 * These are the only new Prices this seeder may create.  The old Starter
 * lookup keys are deliberately absent: they continue to point at USD 39 /
 * USD 397.80 Prices for the old deployment and are never transferred,
 * archived, or otherwise mutated here.
 */
export const STRIPE_CATALOG: readonly CatalogItem[] = [
  {
    key: "starter",
    name: "開賣啦 SellCase Starter",
    description: "1 active webinar and 1,000 registrants per month",
    amount: 2900,
    lookupKey: STARTER_NEW_LOOKUP_KEYS.month,
    fallbackLookupKey: STARTER_NEW_FALLBACK_LOOKUP_KEYS.month,
    interval: "month",
    capacity: "1",
    registrants: "1000",
    priceVersion: "usd29",
  },
  {
    key: "starter",
    name: "開賣啦 SellCase Starter",
    description: "1 active webinar and 1,000 registrants per month",
    amount: 29580,
    lookupKey: STARTER_NEW_LOOKUP_KEYS.year,
    fallbackLookupKey: STARTER_NEW_FALLBACK_LOOKUP_KEYS.year,
    interval: "year",
    capacity: "1",
    registrants: "1000",
    priceVersion: "usd29",
  },
  {
    key: "growth",
    name: "開賣啦 SellCase Growth",
    description: "5 active webinars and 3,000 registrants per month",
    amount: 9900,
    lookupKey: "icta_webinar_growth_monthly",
    interval: "month",
    capacity: "5",
    registrants: "3000",
  },
  {
    key: "growth",
    name: "開賣啦 SellCase Growth",
    description: "5 active webinars and 3,000 registrants per month",
    amount: 100980,
    lookupKey: "icta_webinar_growth_annual",
    interval: "year",
    capacity: "5",
    registrants: "3000",
  },
  {
    key: "scale",
    name: "開賣啦 SellCase Scale",
    description: "15 active webinars and 5,000 registrants per month",
    amount: 19900,
    lookupKey: "icta_webinar_scale_monthly",
    interval: "month",
    capacity: "15",
    registrants: "5000",
  },
  {
    key: "scale",
    name: "開賣啦 SellCase Scale",
    description: "15 active webinars and 5,000 registrants per month",
    amount: 202980,
    lookupKey: "icta_webinar_scale_annual",
    interval: "year",
    capacity: "15",
    registrants: "5000",
  },
  {
    key: "addon",
    name: "開賣啦 SellCase Extra Room",
    description: "1 additional published webinar room",
    amount: 2000,
    lookupKey: ADDON_LOOKUP_KEY,
    interval: "month",
    capacity: "1",
  },
  {
    key: "addon",
    name: "開賣啦 SellCase Extra Room",
    description: "1 additional published webinar room",
    amount: 20400,
    lookupKey: ANNUAL_ADDON_LOOKUP_KEY,
    interval: "year",
    capacity: "1",
  },
];

function priceMatches(price: Stripe.Price, item: CatalogItem): boolean {
  return price.unit_amount === item.amount
    && price.currency === "usd"
    && price.recurring?.interval === item.interval
    && price.type === "recurring";
}

function productIdForPrice(price: Stripe.Price): string | null {
  return typeof price.product === "string" ? price.product : price.product?.id || null;
}

function catalogMetadata(item: CatalogItem): Record<string, string> {
  return {
    ictaCatalogKey: item.key,
    webinarCapacity: item.capacity,
    monthlyRegistrants: item.registrants || "",
    ...(item.priceVersion ? { priceVersion: item.priceVersion } : {}),
  };
}

async function findPricesByLookupKey(stripe: Stripe, lookupKey: string, active: boolean) {
  const result = await stripe.prices.list({ active, lookup_keys: [lookupKey], limit: 100 });
  return result.data;
}

function isDedicatedStarterProduct(product: Stripe.Product | Stripe.DeletedProduct, item: CatalogItem): product is Stripe.Product {
  return item.key === "starter"
    && !("deleted" in product)
    && product.metadata?.ictaCatalogKey === "starter"
    && product.metadata?.priceVersion === item.priceVersion
    && product.metadata?.webinarCapacity === "1"
    && product.metadata?.monthlyRegistrants === "1000";
}

async function productForPrice(stripe: Stripe, price: Stripe.Price): Promise<Stripe.Product | Stripe.DeletedProduct> {
  if (typeof price.product !== "string") return price.product;
  return stripe.products.retrieve(price.product);
}

async function assertPriceProductIdentity(stripe: Stripe, price: Stripe.Price, item: CatalogItem, productId: string): Promise<void> {
  if (productIdForPrice(price) !== productId) {
    throw new Error(`Refusing ${item.lookupKey}: exact price belongs to a different product`);
  }
  const product = await productForPrice(stripe, price);
  if (!isDedicatedStarterProduct(product, item)) {
    throw new Error(`Refusing ${item.lookupKey}: exact price product is not the dedicated Starter USD 29 product`);
  }
}

async function findReusableProduct(
  stripe: Stripe,
  item: CatalogItem,
  existingPrices: Stripe.Price[],
): Promise<string | null> {
  // An exact USD 29 Price is safe to reuse only when its product is already
  // the dedicated, correctly tagged Starter product.  In particular, never
  // adopt a legacy USD 39 product or an unrelated product that happens to own
  // the new lookup key.
  for (const price of existingPrices.filter((candidate) => priceMatches(candidate, item))) {
    const productId = productIdForPrice(price);
    if (!productId) throw new Error(`Refusing ${item.lookupKey}: exact price has no product`);
    const product = await productForPrice(stripe, price);
    if (!isDedicatedStarterProduct(product, item)) {
      throw new Error(`Refusing ${item.lookupKey}: exact price product is not the dedicated Starter USD 29 product`);
    }
    return productId;
  }

  // Only an existing product with the complete dedicated identity is
  // reusable.  There is intentionally no name-based or capacity-only match.
  const products = await stripe.products.list({ active: true, limit: 100 });
  const existing = products.data.find((product) => isDedicatedStarterProduct(product, item));
  return existing?.id || null;
}

async function createPrice(
  stripe: Stripe,
  productId: string,
  item: CatalogItem,
  lookupKey: string,
): Promise<Stripe.Price> {
  return stripe.prices.create({
    product: productId,
    unit_amount: item.amount,
    currency: "usd",
    recurring: { interval: item.interval },
    lookup_key: lookupKey,
  });
}

function isLookupKeyConflict(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return candidate?.code === "resource_already_exists"
    || (typeof candidate?.message === "string" && /lookup.?key|already exists|already in use/i.test(candidate.message));
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  item: CatalogItem,
  inactivePrices: Stripe.Price[],
): Promise<{ price: Stripe.Price; created: boolean; lookupKey: string }> {
  const activePrices = await findPricesByLookupKey(stripe, item.lookupKey, true);
  const exactActive = activePrices.find((price) => priceMatches(price, item));
  if (exactActive) {
    await assertPriceProductIdentity(stripe, exactActive, item, productId);
    return { price: exactActive, created: false, lookupKey: item.lookupKey };
  }

  const exactInactive = inactivePrices.find((price) => priceMatches(price, item));
  if (exactInactive) {
    await assertPriceProductIdentity(stripe, exactInactive, item, productId);
    const reactivated = await stripe.prices.update(exactInactive.id, { active: true });
    return { price: reactivated, created: false, lookupKey: item.lookupKey };
  }

  // Never mutate an active mismatched Price.  A mismatch on a price-specific
  // key is recovered with the deterministic fallback key, which is also in
  // the server allowlist.
  try {
    const created = await createPrice(stripe, productId, item, item.lookupKey);
    return { price: created, created: true, lookupKey: item.lookupKey };
  } catch (error) {
    if (!item.fallbackLookupKey || !isLookupKeyConflict(error)) throw error;
    const fallbackActive = await findPricesByLookupKey(stripe, item.fallbackLookupKey, true);
    const exactFallback = fallbackActive.find((price) => priceMatches(price, item));
    if (exactFallback) {
      await assertPriceProductIdentity(stripe, exactFallback, item, productId);
      return { price: exactFallback, created: false, lookupKey: item.fallbackLookupKey };
    }
    const fallbackInactive = await findPricesByLookupKey(stripe, item.fallbackLookupKey, false);
    const exactInactiveFallback = fallbackInactive.find((price) => priceMatches(price, item));
    if (exactInactiveFallback) {
      await assertPriceProductIdentity(stripe, exactInactiveFallback, item, productId);
      const reactivated = await stripe.prices.update(exactInactiveFallback.id, { active: true });
      return { price: reactivated, created: false, lookupKey: item.fallbackLookupKey };
    }
    const created = await createPrice(stripe, productId, item, item.fallbackLookupKey);
    return { price: created, created: true, lookupKey: item.fallbackLookupKey };
  }
}

export async function readStripeCatalog(): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve();
  console.log(`Stripe account: ${account.id}`);
  for (const item of STRIPE_CATALOG) {
    const active = await findPricesByLookupKey(stripe, item.lookupKey, true);
    const inactive = await findPricesByLookupKey(stripe, item.lookupKey, false);
    const old = item.key === "starter"
      ? await findPricesByLookupKey(
        stripe,
        item.interval === "year" ? STARTER_LEGACY_LOOKUP_KEYS.year : STARTER_LEGACY_LOOKUP_KEYS.month,
        true,
      )
      : [];
    console.log(JSON.stringify({
      lookupKey: item.lookupKey,
      expectedAmount: item.amount,
      active: active.map((price) => ({ id: price.id, amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval, product: productIdForPrice(price) })),
      inactive: inactive.map((price) => ({ id: price.id, amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval, product: productIdForPrice(price) })),
      legacyActive: old.map((price) => ({ id: price.id, amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval, product: productIdForPrice(price) })),
    }));
  }
}

export async function seedProducts(stripeClient?: Stripe): Promise<void> {
  const stripe = stripeClient || await getUncachableStripeClient();
  // Validate every existing exact USD 29 Price before creating either part of
  // the pair.  A bad archived annual key must fail without leaving a newly
  // created monthly object behind.
  for (const item of STRIPE_CATALOG) {
    if (item.key !== "starter") continue;
    const active = await findPricesByLookupKey(stripe, item.lookupKey, true);
    const inactive = await findPricesByLookupKey(stripe, item.lookupKey, false);
    for (const price of [...active, ...inactive].filter((candidate) => priceMatches(candidate, item))) {
      const product = await productForPrice(stripe, price);
      if (!isDedicatedStarterProduct(product, item)) {
        throw new Error(`Refusing ${item.lookupKey}: exact price product is not the dedicated Starter USD 29 product`);
      }
    }
  }
  for (const item of STRIPE_CATALOG) {
    // This rollout owns only the new Starter prices.  Existing Growth, Scale,
    // and add-on objects are read by --read but never created or changed.
    if (item.key !== "starter") continue;
    const targetInactive = await findPricesByLookupKey(stripe, item.lookupKey, false);
    const targetActive = await findPricesByLookupKey(stripe, item.lookupKey, true);
    const productId = await findReusableProduct(stripe, item, [...targetActive, ...targetInactive]);
    if (!productId) {
      const product = await stripe.products.create({
        name: item.name,
        description: item.description,
        metadata: catalogMetadata(item),
      });
      const ensured = await ensurePrice(stripe, product.id, item, targetInactive);
      console.log(`${item.lookupKey}: ${ensured.created ? "created" : "reused"} ${ensured.price.id}`);
      continue;
    }

    const ensured = await ensurePrice(stripe, productId, item, targetInactive);
    console.log(`${item.lookupKey}: ${ensured.created ? "created" : "reused"} ${ensured.price.id}`);
  }
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  if (!write) {
    await readStripeCatalog();
    return;
  }
  if (process.env.STRIPE_CATALOG_WRITE_APPROVED !== "1") {
    throw new Error("Refusing catalog writes: set STRIPE_CATALOG_WRITE_APPROVED=1 after approval");
  }
  await seedProducts();
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Stripe catalog operation failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}