// Controller functions for the two email triggers. Both are safe to call without awaiting: they never throw
// and never touch the store, so a mail problem can't affect listings or orders.
import { getOwnerEmails, isValidEmail, sendMail } from './mailer.js';
import { newListingEmail, ownerOrderEmail, sellerOrderEmail } from './emailTemplates.js';

// Trigger 1 — a seller uploaded a product  ->  ONE email to ALL owners (OWNER_EMAILS).
export async function notifyOwnersNewListing({ listing, seller }, opts = {}) {
  try {
    const owners = getOwnerEmails();
    if (!owners.length) { console.warn('[mail] OWNER_EMAILS is empty — new-product email not sent'); return { ok: false, skipped: 'no-owner-emails' }; }
    const mail = newListingEmail({ listing, seller });
    return await sendMail({ to: owners, ...mail, ...(isValidEmail(seller.email) ? { replyTo: seller.email } : {}) }, opts);
  } catch (error) {
    console.error('[mail] new-product notification crashed:', error.message);
    return { ok: false, error: error.message };
  }
}

// Trigger 2 — a customer placed an order  ->  full email to ALL owners + one filtered email to each seller whose products were ordered.
// `store` is a snapshot of the data (used only to look up seller names / emails).
export async function notifyNewOrder(order, store, opts = {}) {
  const result = { owners: null, sellers: [] };
  try {
    const sellersById = new Map((store.resellers || []).map((r) => [r.id, r]));
    // Every line gets a "sold by" label for the owners; sellers only ever receive their own lines.
    const lines = order.items.map((item) => ({ ...item, soldBy: item.resellerId ? (sellersById.get(item.resellerId)?.displayName || 'Seller') : 'ZEEOR (own product)' }));

    const owners = getOwnerEmails();
    if (owners.length) result.owners = await sendMail({ to: owners, ...ownerOrderEmail({ order: { ...order, items: lines } }) }, opts);
    else console.warn('[mail] OWNER_EMAILS is empty — owner order email not sent');

    const bySeller = new Map();
    for (const line of lines) if (line.resellerId) bySeller.set(line.resellerId, [...(bySeller.get(line.resellerId) || []), line]);
    result.sellers = await Promise.all([...bySeller.entries()].map(async ([sellerId, items]) => {
      const seller = sellersById.get(sellerId);
      if (!seller) return { sellerId, skipped: 'seller-not-found' };
      if (!isValidEmail(seller.email)) { console.warn(`[mail] seller @${seller.username} has no email — order ${order.id} email not sent (they still get the in-panel notification)`); return { sellerId, skipped: 'seller-has-no-email' }; }
      const res = await sendMail({ to: seller.email, replyTo: owners[0], ...sellerOrderEmail({ order, seller, items }) }, opts);
      return { sellerId, ...res };
    }));
  } catch (error) {
    console.error('[mail] order notification crashed:', error.message);
    result.error = error.message;
  }
  return result;
}
