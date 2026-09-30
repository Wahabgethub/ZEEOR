# ZEEOR email notifications

Emails are sent by the server with Nodemailer over plain SMTP (no Firebase, no third-party SDK).

| Event | Who gets it |
|---|---|
| Seller uploads a product | **All** addresses in `OWNER_EMAILS` (one email) |
| Customer places an order | **All** owners: full order. **Each affected seller**: only their own items + delivery details |

Add to the server's `.env`, then run `npm install` and restart:

```env
OWNER_EMAILS=owner1@zeeor.shop,owner2@zeeor.shop
SITE_URL=https://zeeor.shop
MAIL_FROM="ZEEOR <no-reply@zeeor.shop>"
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=your-api-key
```

Other providers (same variables): SendGrid `smtp.sendgrid.net` / 587 / user `apikey` / pass = API key; Gmail `smtp.gmail.com` / 587 / your address / an *app password*.
Use a sender address on a domain you have verified with the provider, or mail will land in spam or be rejected.

Sellers get order emails only if the owner set their business email (Owner Studio → Sellers → *Set email*).
If SMTP is not configured the site works exactly as before; the server log says the emails are switched off.
