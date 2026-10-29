# MCGT Artwork Upload (Shopify app)

Lets customers of [mcgtltd.com](https://mcgtltd.com) attach their own image to a
product before adding it to the cart. Manchester Custom Graphic T-Shirt Ltd then prints it
with DTF/DTG.

This repo is only the **storefront half**: the Shopify app config and a theme app extension.
The files here are served to every visitor of the store anyway, so the repo is public. The
backend that stores uploads is a private Google Cloud Function.

## How it works

```
Product page (tagged `artwork-upload`)
  │ 1. GET /apps/mcgt-artwork/ticket       Shopify app proxy: Shopify signs the request
  │                                        with the app secret; the backend checks it and
  │                                        returns a single-use upload ticket (10 min)
  │ 2. PUT <backend>/upload?t=<ticket>     PNG/JPG ≤ 20MB → private storage, "pending"
  │ 3. cart line gets properties:
  │      Artwork            = file name    (customer sees this in cart/checkout)
  │      _artwork_id        = upload id    (hidden)
  │      _artwork_required  = 1            (hidden; lets staff spot a line with no upload)
  ▼
Checkout → orders/create webhook (HMAC-signed) → the backend claims the order's uploads,
copies them into the shop's Google Drive and emails staff. Uploads that never become an
order are deleted after about an hour.
```

## Layout

| Path | What |
|---|---|
| `shopify.app.toml` | App config: `read_orders` scope, `orders/create` webhook, app proxy `/apps/mcgt-artwork` |
| `extensions/artwork-upload/blocks/artwork-upload.liquid` | The "Artwork upload" app block (product template) |
| `extensions/artwork-upload/assets/artwork-upload.js` | Ticket → upload → cart properties; blocks add-to-cart until the upload is done |
| `extensions/artwork-upload/assets/artwork-upload.css` | Styles; inherits the theme's foreground colour |

## Using it in the store

1. In the theme editor, open **Products → Default product**. In the product details, choose
   **Add block → Apps → Artwork upload**, drag it above the buy buttons, and save.
2. Tag any product that should take an upload with `artwork-upload`. The block hides itself on
   every other product.
3. Block settings: the heading, help text, rights note, whether an upload is required, and the
   tag it looks for.

The block hides Shop Pay and other express buttons on upload products, because they would skip
the "artwork required" check.

## Deploy

Needs [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) 3.x, logged in to the account
that owns the app.

```bash
shopify app config link     # first time only: fills client_id
shopify app deploy          # releases the extension + config (webhook, proxy)
```

## Testing

`tests/storefront_e2e.py` drives the live product page in a local Selenium Chromium: it checks the
block renders only on tagged products, blocks add-to-cart without an upload, uploads a PNG, and
checks the cart line properties. See the header of that file for how to run it.

## Licence

MIT. See `LICENSE`.
