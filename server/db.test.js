import { describe, expect, it } from 'vitest';
import { productTotalStock, publicProduct, readStore } from './db.js';

describe('ZEEOR data layer', () => {
  it('loads the seeded catalog', () => {
    const store = readStore();
    expect(store.products.length).toBeGreaterThanOrEqual(6);
    expect(store.products[0].inventory['Obsidian-M']).toBe(8);
  });

  it('hides inventory from customer-facing product objects', () => {
    const product = readStore().products[0];
    expect(publicProduct(product).inventory).toBeUndefined();
    expect(productTotalStock(product)).toBeGreaterThan(0);
  });
});
