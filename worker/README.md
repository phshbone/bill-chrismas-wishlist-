# Cloudflare backend

This folder contains the first backend vertical slice for the blind Christmas wishlist.

## Required Cloudflare pieces

- One Worker
- One D1 database bound to the Worker as `DB`
- `FRONTEND_ORIGIN=https://phshbone.github.io`
- `SESSION_DAYS=180`
- A secret named `BOOTSTRAP_ADMIN_CODE`

The bootstrap code is only for UB's first setup. Do not put the real value in GitHub.

## Database

Run `schema.sql` against the D1 database once. It creates the launch members:

- UB
- Bill
- Michele
- Mac
- Mollie
- Brett

UB is the only launch admin.

## First setup

1. Configure the Worker secret `BOOTSTRAP_ADMIN_CODE`.
2. Open the app and choose UB.
3. Enter that bootstrap code and create UB's personal password.
4. Sign in as UB.
5. In Member Management, issue one-time setup codes to the other family members.
6. Each family member selects their elf, enters the one-time code, and creates a personal password.
7. The browser stores only the opaque session token. Password hashes and one-time-code hashes stay in D1.

## Privacy boundary

The owner's wishlist endpoint deliberately performs no claim join. An owner cannot obtain reservation or purchase state for their own wishes through the API.

Other shoppers receive only `available` or `taken`. Claimant identity is returned only by the authenticated claimant's private `/api/shopping` endpoint.

Admin status does not override this rule.

## Deactivation behavior

Deactivating a member:

- blocks login,
- revokes current sessions,
- removes the member from the active home screen,
- releases still-reserved gifts,
- preserves purchased gift history.

## Future barcode support

The wish schema already has optional barcode and product-image fields. A separate product-cache table/provider ladder should be added only after the blind-wishlist vertical slice is proven.