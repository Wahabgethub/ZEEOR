import { describe, expect, it, vi } from 'vitest';
import { parseEmailList } from './mailer.js';
import { notifyNewOrder, notifyOwnersNewListing } from './emailNotifications.js';

const fakeTransport = () => { const sent = []; return { sent, sendMail: vi.fn(async (msg) => { sent.push(msg); return { accepted: msg.to, rejected: [] }; }) }; };
const store = { resellers: [
  { id: 'r1', username: 'ali', displayName: 'Ali Store', email: 'ali@shop.pk', whatsapp: '923001112222' },
  { id: 'r2', username: 'sana', displayName: 'Sana Boutique', email: 'sana@shop.pk' },
  { id: 'r3', username: 'noemail', displayName: 'No Email' },
] };
const order = { id: 'Z-1', createdAt: new Date().toISOString(), customer: { name: 'Bob <script>alert(1)</script>', phone: '0300', email: 'bob@x.com', address: '1 Road', city: 'Multan' }, items: [
  { productId: 'a', resellerId: 'r1', name: 'Oud Perfume', size: 'One Size', color: 'Default', quantity: 2, unitPrice: 1500 },
  { productId: 'b', resellerId: 'r2', name: 'Kurta', size: 'M', color: 'Green', quantity: 1, unitPrice: 3500 },
  { productId: 'c', resellerId: 'r3', name: 'Scarf', size: 'One Size', color: 'Default', quantity: 1, unitPrice: 900 },
  { productId: 'd', name: 'Own Shirt', size: 'L', color: 'Blue', quantity: 1, unitPrice: 2000 },
], subtotal: 9400, discount: 0, shipping: 0, total: 9400, payment: 'cod', status: 'Pending' };

describe('email notifications', () => {
  it('parses owner emails from env-style lists', () => {
    expect(parseEmailList('a@x.com, B@x.com;a@x.com bad')).toEqual(['a@x.com', 'b@x.com']);
    expect(parseEmailList('["a@x.com","b@x.com"]')).toEqual(['a@x.com', 'b@x.com']);
    expect(parseEmailList('')).toEqual([]);
  });
  it('sends the full order to all owners and a filtered order to each seller only', async () => {
    process.env.OWNER_EMAILS = 'owner1@zeeor.shop,owner2@zeeor.shop';
    const transport = fakeTransport();
    const result = await notifyNewOrder(order, store, { transport, from: 'ZEEOR <n@zeeor.shop>' });
    const owner = transport.sent.find((m) => m.to.length === 2);
    expect(owner.to).toEqual(['owner1@zeeor.shop', 'owner2@zeeor.shop']);
    for (const name of ['Oud Perfume', 'Kurta', 'Scarf', 'Own Shirt']) expect(owner.html).toContain(name);
    expect(owner.html).not.toContain('<script>');
    const ali = transport.sent.find((m) => m.to[0] === 'ali@shop.pk');
    expect(ali.html).toContain('Oud Perfume'); expect(ali.html).not.toContain('Kurta'); expect(ali.html).not.toContain('Scarf'); expect(ali.html).not.toContain('Own Shirt'); expect(ali.html).not.toContain('Rs 9,400'); expect(ali.html).not.toContain('bob@x.com');
    expect(transport.sent.find((m) => m.to[0] === 'sana@shop.pk').html).not.toContain('Oud Perfume');
    expect(transport.sent).toHaveLength(3); // owners + ali + sana; the seller without an email is skipped
    expect(result.sellers.find((s) => s.sellerId === 'r3').skipped).toBe('seller-has-no-email');
  });
  it('emails all owners when a seller uploads a product', async () => {
    process.env.OWNER_EMAILS = 'owner1@zeeor.shop,owner2@zeeor.shop';
    const transport = fakeTransport();
    await notifyOwnersNewListing({ listing: { id: 'l-1', title: 'Rose <b>Attar</b>', price: 1200, category: 'Perfumes', subcategory: 'Attar', images: ['https://res.cloudinary.com/x/a.jpg'], active: true }, seller: store.resellers[0] }, { transport, from: 'n@zeeor.shop' });
    const mail = transport.sent[0];
    expect(mail.to).toEqual(['owner1@zeeor.shop', 'owner2@zeeor.shop']);
    for (const text of ['Ali Store', 'ali@shop.pk', 'Rs 1,200', 'Perfumes › Attar', 'https://res.cloudinary.com/x/a.jpg', 'Live on the store']) expect(mail.html).toContain(text);
    expect(mail.html).not.toContain('<b>Attar</b>');
  });
  it('does nothing (and does not throw) when there are no owner emails / SMTP', async () => {
    process.env.OWNER_EMAILS = ''; delete process.env.SMTP_HOST;
    expect((await notifyOwnersNewListing({ listing: { id: 'x', title: 't', price: 1 }, seller: store.resellers[0] })).ok).toBe(false);
  });
});
