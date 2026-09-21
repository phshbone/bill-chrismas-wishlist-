# Bill Christmas Wishlist

Blind family Christmas wishlist PWA.

## Locked MVP behavior

- Members: UB, Bill, Michele, Mac, Mollie, Brett.
- Each member can add, edit, and remove only their own wishes.
- A recipient never receives claim/reservation/purchase information for their own wishes.
- Other shoppers see only AVAILABLE or TAKEN.
- Claims are privately tracked as reserved or purchased.
- Each shopper has a private shopping list.
- New-item lights are per viewer and clear only after that viewer opens the list.
- Deleted members are deactivated, not hard-deleted.
- Deactivation releases reserved gifts but preserves purchased history.
- UB is admin for membership/access only; admin status does not bypass gift privacy.

## Architecture

- Frontend: static HTML/CSS/JS PWA on GitHub Pages.
- API: Cloudflare Worker.
- Database: Cloudflare D1.
- Authentication: one-time setup code -> personal password -> remembered device session.
- Future: barcode scan/product lookup cache and optional product photos.

## Branch

`foundation-v1` contains the first vertical-slice implementation.

## First acceptance test

1. UB signs in and adds a wish.
2. Mollie signs in and sees it as AVAILABLE.
3. Mollie reserves it.
4. Everyone else sees TAKEN.
5. UB opens his own list and receives no indication that it was reserved.
6. Mollie's private Shopping List shows her reservation.

## Backend setup

See `worker/README.md`.