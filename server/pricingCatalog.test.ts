import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { PLAN_PRICING } from "@shared/pricing";
import {
  planKeyForLookupKey,
  planLookupKey,
  STARTER_LEGACY_LOOKUP_KEYS,
  STARTER_NEW_FALLBACK_LOOKUP_KEYS,
  STARTER_NEW_LOOKUP_KEYS,
} from "./subscriptionEntitlements";
import { STRIPE_CATALOG } from "./seed-stripe-products";
import { monthlyGiftForLookupKeys } from "./subscriptionCreditGrants";

type FakeCatalog = {
  stripe: Stripe;
  products: Map<string, any>;
  prices: Map<string, any>;
  calls: { productCreates: number; productUpdates: number; priceCreates: number; priceUpdates: number };
};

function fakeCatalog(initial: { products?: any[]; prices?: any[] } = {}): FakeCatalog {
  const products = new Map((initial.products || []).map((product) => [product.id, { active: true, ...product }]));
  const prices = new Map((initial.prices || []).map((price) => [
    price.id,
    { active: true, type: "recurring", currency: "usd", ...price },
  ]));
  const calls = { productCreates: 0, productUpdates: 0, priceCreates: 0, priceUpdates: 0 };
  let productSequence = 0;
  let priceSequence = 0;
  const stripe = {
    products: {
      list: async ({ active }: { active: boolean }) => ({
        data: Array.from(products.values()).filter((product) => product.active === active),
      }),
      retrieve: async (id: string) => products.get(id),
      create: async (params: any) => {
        calls.productCreates += 1;
        const product = { id: `prod_new_${++productSequence}`, active: true, ...params };
        products.set(product.id, product);
        return product;
      },
      update: async (id: string, params: any) => {
        calls.productUpdates += 1;
        const product = products.get(id);
        Object.assign(product, params);
        return product;
      },
    },
    prices: {
      list: async ({ active, lookup_keys }: { active: boolean; lookup_keys: string[] }) => ({
        data: Array.from(prices.values()).filter((price) =>
          price.active === active && lookup_keys.includes(price.lookup_key)),
      }),
      create: async (params: any) => {
        if (Array.from(prices.values()).some((price) => price.lookup_key === params.lookup_key)) {
          const error = new Error("lookup key already in use") as Error & { code: string };
          error.code = "resource_already_exists";
          throw error;
        }
        calls.priceCreates += 1;
        const price = {
          id: `price_new_${++priceSequence}`,
          active: true,
          type: "recurring",
          currency: "usd",
          ...params,
        };
        prices.set(price.id, price);
        return price;
      },
      update: async (id: string, params: any) => {
        calls.priceUpdates += 1;
        const price = prices.get(id);
        Object.assign(price, params);
        return price;
      },
    },
  } as unknown as Stripe;
  return { stripe, products, prices, calls };
}

const oldStarterProduct = {
  id: "prod_old_starter",
  name: "開賣啦 SellCase Starter",
  metadata: { ictaCatalogKey: "starter", webinarCapacity: "1", monthlyRegistrants: "1000" },
};

function oldStarterPrices() {
  return [
    {
      id: "price_old_39",
      product: oldStarterProduct.id,
      lookup_key: STARTER_LEGACY_LOOKUP_KEYS.month,
      unit_amount: 3900,
      recurring: { interval: "month" },
    },
    {
      id: "price_old_39780",
      product: oldStarterProduct.id,
      lookup_key: STARTER_LEGACY_LOOKUP_KEYS.year,
      unit_amount: 39780,
      recurring: { interval: "year" },
    },
  ];
}

test("shared public pricing keeps fixed TWD references and annual 85% math", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(PLAN_PRICING).map(([key, plan]) => [
      key,
      [plan.monthlyUSD, plan.annualUSD, plan.monthlyTWDReference, plan.annualTWD, plan.equivalentMonthlyTWD],
    ])),
    {
      starter: [29, 295.8, 890, 9078, 756.5],
      growth: [99, 1009.8, 3000, 30600, 2550],
      scale: [199, 2029.8, 6000, 61200, 5100],
    },
  );
});

test("catalog switching selects dedicated Starter USD 29 keys without touching old USD 39 keys", () => {
  const starterItems = STRIPE_CATALOG.filter((item) => item.key === "starter");
  assert.deepEqual(
    starterItems.map((item) => [item.lookupKey, item.amount, item.interval]),
    [
      [STARTER_NEW_LOOKUP_KEYS.month, 2900, "month"],
      [STARTER_NEW_LOOKUP_KEYS.year, 29580, "year"],
    ],
  );
  assert.equal(starterItems.some((item) => item.lookupKey === STARTER_LEGACY_LOOKUP_KEYS.month), false);
  assert.equal(starterItems.some((item) => item.lookupKey === STARTER_LEGACY_LOOKUP_KEYS.year), false);
  assert.equal(planLookupKey("starter", "month"), STARTER_NEW_LOOKUP_KEYS.month);
  assert.equal(planLookupKey("starter", "year"), STARTER_NEW_LOOKUP_KEYS.year);
});

test("old Starter lookup keys retain plan and one-year 100-point grant semantics", () => {
  assert.equal(planKeyForLookupKey(STARTER_LEGACY_LOOKUP_KEYS.month), "starter");
  assert.equal(planKeyForLookupKey(STARTER_LEGACY_LOOKUP_KEYS.year), "starter");
  assert.deepEqual(
    monthlyGiftForLookupKeys([STARTER_LEGACY_LOOKUP_KEYS.year]),
    { planKey: "starter", points: 100 },
  );
});

test("DI seeder creates one dedicated Starter product and is idempotent without legacy updates", async () => {
  const { seedProducts } = await import("./seed-stripe-products");
  const fake = fakeCatalog({ products: [oldStarterProduct], prices: oldStarterPrices() });
  await seedProducts(fake.stripe);
  await seedProducts(fake.stripe);

  assert.equal(fake.calls.productCreates, 1);
  assert.equal(fake.calls.priceCreates, 2);
  assert.equal(fake.calls.productUpdates, 0);
  assert.equal(fake.calls.priceUpdates, 0);
  assert.deepEqual(fake.products.get(oldStarterProduct.id)?.metadata, oldStarterProduct.metadata);
  const starterPrices = Array.from(fake.prices.values()).filter((price) => price.product !== oldStarterProduct.id);
  assert.deepEqual(
    starterPrices.map((price) => [price.lookup_key, price.unit_amount, price.product]),
    [
      [STARTER_NEW_LOOKUP_KEYS.month, 2900, "prod_new_1"],
      [STARTER_NEW_LOOKUP_KEYS.year, 29580, "prod_new_1"],
    ],
  );
});

test("DI seeder routes an occupied new key to a dedicated fallback without mutating its occupant", async () => {
  const unrelated = {
    id: "prod_unrelated",
    metadata: { ictaCatalogKey: "growth", webinarCapacity: "5", monthlyRegistrants: "3000" },
  };
  const occupied = {
    id: "price_occupied",
    product: unrelated.id,
    lookup_key: STARTER_NEW_LOOKUP_KEYS.month,
    unit_amount: 3100,
    recurring: { interval: "month" },
  };
  const { seedProducts } = await import("./seed-stripe-products");
  const fake = fakeCatalog({ products: [unrelated], prices: [occupied] });
  await seedProducts(fake.stripe);
  await seedProducts(fake.stripe);

  assert.equal(fake.calls.productUpdates, 0);
  assert.equal(fake.calls.priceUpdates, 0);
  assert.deepEqual(fake.products.get(unrelated.id)?.metadata, unrelated.metadata);
  assert.equal(fake.prices.get(occupied.id)?.unit_amount, 3100);
  assert.equal(
    Array.from(fake.prices.values()).some((price) => price.lookup_key === STARTER_NEW_FALLBACK_LOOKUP_KEYS.month),
    true,
  );
  assert.equal(
    Array.from(fake.prices.values()).filter((price) => price.product !== unrelated.id && price.unit_amount === 2900).length,
    1,
  );
});

test("DI seeder rejects an archived exact USD 29 key on an unrelated product before creating anything", async () => {
  const unrelated = {
    id: "prod_archived_owner",
    metadata: { ictaCatalogKey: "growth", webinarCapacity: "5", monthlyRegistrants: "3000" },
  };
  const archivedExact = {
    id: "price_archived_exact",
    active: false,
    product: unrelated.id,
    lookup_key: STARTER_NEW_LOOKUP_KEYS.year,
    unit_amount: 29580,
    recurring: { interval: "year" },
  };
  const { seedProducts } = await import("./seed-stripe-products");
  const fake = fakeCatalog({ products: [unrelated], prices: [archivedExact] });
  await assert.rejects(() => seedProducts(fake.stripe), /not the dedicated Starter USD 29 product/);
  assert.equal(fake.calls.productCreates, 0);
  assert.equal(fake.calls.productUpdates, 0);
  assert.equal(fake.calls.priceCreates, 0);
  assert.equal(fake.calls.priceUpdates, 0);
  assert.deepEqual(fake.products.get(unrelated.id)?.metadata, unrelated.metadata);
});