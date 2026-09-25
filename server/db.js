import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(root, '..', 'data', 'store.json');

export function readStore() {
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

export function writeStore(store) {
  const temp = `${dataPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2));
  fs.renameSync(temp, dataPath);
  return store;
}

export function mutateStore(mutator) {
  const store = readStore();
  const result = mutator(store) || store;
  return writeStore(result);
}

export function publicProduct(product) {
  if (!product) return null;
  const availability = Object.fromEntries(Object.entries(product.inventory || {}).map(([key, value]) => [key, Number(value || 0) > 0 ? 1 : 0]));
  return { ...product, inventory: undefined, availability };
}

export function productTotalStock(product) {
  return Object.values(product.inventory || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}
