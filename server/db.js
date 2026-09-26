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

// One-time (and ongoing) upgrade of legacy string categories (["Women","Men"]) into
// owned category objects { id, name, scope: 'general'|'private', resellerId, order }.
// Safe to call on every boot — it's a no-op once the shape is already correct.
export function ensureCategoriesShape() {
  mutateStore((store) => {
    let changed = false;
    const cats = Array.isArray(store.categories) ? store.categories : [];
    if (!Array.isArray(store.categories)) changed = true;
    const normalized = cats.map((c, i) => {
      if (typeof c === 'string') { changed = true; return { id: `c-legacy-${i}-${Date.now()}`, name: c, scope: 'general', resellerId: null, order: i }; }
      if (c && c.order === undefined) { changed = true; return { ...c, order: i }; }
      return c;
    });
    if (changed) store.categories = normalized;
    return changed ? store : store;
  });
}

export function categoryList(store) { return (store.categories || []).slice().sort((a, b) => a.order - b.order); }
export function visibleCategoryNames(store) {
  const activeResellerIds = new Set(store.resellers.filter((r) => r.active !== false).map((r) => r.id));
  return categoryList(store).filter((c) => c.scope !== 'private' || activeResellerIds.has(c.resellerId)).map((c) => c.name);
}
export function generalCategoryNames(store) { return categoryList(store).filter((c) => c.scope !== 'private').map((c) => c.name); }
export function resellerCategoryNames(store, resellerId) { return categoryList(store).filter((c) => c.scope !== 'private' || c.resellerId === resellerId).map((c) => c.name); }
