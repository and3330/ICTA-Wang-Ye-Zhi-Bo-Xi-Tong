import { getUncachableStripeClient } from './stripeClient';

async function seedProducts() {
  const stripe = await getUncachableStripeClient();
  const catalog = [
    { key: 'starter', name: 'ICTA Webinar Starter', description: '1 active webinar and 1,000 registrants per month', amount: 3900, lookupKey: 'icta_webinar_starter_monthly', capacity: '1', registrants: '1000' },
    { key: 'starter', name: 'ICTA Webinar Starter', description: '1 active webinar and 1,000 registrants per month', amount: 39780, lookupKey: 'icta_webinar_starter_annual', interval: 'year', capacity: '1', registrants: '1000' },
    { key: 'growth', name: 'ICTA Webinar Growth', description: '5 active webinars and 3,000 registrants per month', amount: 9900, lookupKey: 'icta_webinar_growth_monthly', capacity: '5', registrants: '3000' },
    { key: 'growth', name: 'ICTA Webinar Growth', description: '5 active webinars and 3,000 registrants per month', amount: 100980, lookupKey: 'icta_webinar_growth_annual', interval: 'year', capacity: '5', registrants: '3000' },
    { key: 'scale', name: 'ICTA Webinar Scale', description: '15 active webinars and 5,000 registrants per month', amount: 19900, lookupKey: 'icta_webinar_scale_monthly', capacity: '15', registrants: '5000' },
    { key: 'scale', name: 'ICTA Webinar Scale', description: '15 active webinars and 5,000 registrants per month', amount: 202980, lookupKey: 'icta_webinar_scale_annual', interval: 'year', capacity: '15', registrants: '5000' },
    { key: 'addon', name: 'ICTA Webinar Extra Room', description: '1 additional published webinar room', amount: 2000, lookupKey: 'icta_webinar_room_addon_monthly', capacity: '1' },
    { key: 'addon', name: 'ICTA Webinar Extra Room', description: '1 additional published webinar room', amount: 20400, lookupKey: 'icta_webinar_room_addon_annual', interval: 'year', capacity: '1' },
  ];

  for (const item of catalog) {
    const existingPrices = await stripe.prices.list({ active: true, lookup_keys: [item.lookupKey], limit: 1 });
    if (existingPrices.data.length) {
      const existingPrice = existingPrices.data[0];
      const productId = typeof existingPrice.product === 'string'
        ? existingPrice.product
        : existingPrice.product.id;
      await stripe.products.update(productId, {
        name: item.name,
        description: item.description,
        metadata: {
          ictaCatalogKey: item.key,
          webinarCapacity: item.capacity,
          monthlyRegistrants: item.registrants || '',
        },
      });
      const priceMatches = existingPrice.unit_amount === item.amount
        && existingPrice.currency === 'usd'
        && existingPrice.recurring?.interval === (item.interval || 'month');
      if (!priceMatches) {
        const replacement = await stripe.prices.create({
          product: productId,
          unit_amount: item.amount,
          currency: 'usd',
          recurring: { interval: (item.interval || 'month') as 'month' | 'year' },
          lookup_key: item.lookupKey,
          transfer_lookup_key: true,
        });
        await stripe.prices.update(existingPrice.id, { active: false });
        console.log(`${item.name} price replaced: ${replacement.id}`);
        continue;
      }
      console.log(`${item.name} synced: ${existingPrice.id}`);
      continue;
    }
    const product = await stripe.products.create({
      name: item.name,
      description: item.description,
      metadata: { ictaCatalogKey: item.key, webinarCapacity: item.capacity, monthlyRegistrants: item.registrants || '' },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: item.amount,
      currency: 'usd',
      recurring: { interval: (item.interval || 'month') as 'month' | 'year' },
      lookup_key: item.lookupKey,
    });
    console.log(`Created ${item.name}: ${price.id}`);
  }
}

seedProducts()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
