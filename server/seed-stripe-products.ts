import { getUncachableStripeClient } from './stripeClient';

async function seedProducts() {
  const stripe = await getUncachableStripeClient();
  const catalog = [
    { key: 'starter', name: 'ICTA Webinar Starter', description: '2 published webinar rooms', amount: 4900, lookupKey: 'icta_webinar_starter_monthly', capacity: '2' },
    { key: 'growth', name: 'ICTA Webinar Growth', description: '5 published webinar rooms', amount: 9900, lookupKey: 'icta_webinar_growth_monthly', capacity: '5' },
    { key: 'addon', name: 'ICTA Webinar Extra Room', description: '1 additional published webinar room', amount: 2000, lookupKey: 'icta_webinar_room_addon_monthly', capacity: '1' },
  ];

  for (const item of catalog) {
    const existingPrices = await stripe.prices.list({ active: true, lookup_keys: [item.lookupKey], limit: 1 });
    if (existingPrices.data.length) {
      console.log(`${item.name} already exists: ${existingPrices.data[0].id}`);
      continue;
    }
    const product = await stripe.products.create({
      name: item.name,
      description: item.description,
      metadata: { ictaCatalogKey: item.key, webinarCapacity: item.capacity },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: item.amount,
      currency: 'usd',
      recurring: { interval: 'month' },
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
