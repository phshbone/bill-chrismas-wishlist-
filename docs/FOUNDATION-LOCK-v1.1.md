# Foundation Lock v1.1

## Canonical members

- UB — admin
- Bill
- Michele
- Mac
- Mollie
- Brett

Display names are not database identity keys.

## Blindness rule

A wishlist owner must never receive claim, reservation, purchase, or claimant information for their own wishes.

This is enforced by the Worker response contract, not hidden in the frontend.

## Shopper view

For another member's active wish, a shopper receives only:

- AVAILABLE
- TAKEN

TAKEN can mean reserved or purchased. The claimant's identity is never returned.

## Private shopping list

Only the authenticated claimant can retrieve their private reservations/purchases.

Internal states:

- reserved
- purchased
- released

## Wish edits

Editing an existing wish increments its version.

A claim stores the wish version and a snapshot of the title/link/notes at reservation time. The claimant can therefore see that a wish changed after reservation and compare original vs current details.

Editing an existing wish does not activate the green NEW light.

## Wish removal

Removing a wish is a soft delete.

The owner sees the item disappear normally and receives no indication whether it had been claimed.

If a shopper had reserved or purchased it, their private Shopping List preserves the original reservation and shows that the recipient removed the wish.

## New light

NEW is per viewer, not global.

A member's green light is on for a viewer when that member has an active wish created after the viewer's last recorded visit to that wishlist.

Opening the wishlist clears NEW only for that viewer.

## Member removal

Members are deactivated, not hard-deleted.

Deactivation:

- removes the member from the active family home screen,
- blocks login and revokes sessions,
- releases reserved gifts,
- preserves purchased history and database relationships.

Reactivation restores the existing member record and wishlist history.

## Authentication

First use:

1. Select your elf/member.
2. Enter a one-time setup code.
3. Create a personal password.
4. The device stores an opaque session token and remains signed in.

UB bootstraps with a Cloudflare Worker secret. UB can then issue one-time setup codes to the remaining family members.

Passwords, setup codes, and session tokens are never stored in plaintext in D1.

## Admin boundary

UB's admin role permits member/access management only.

Admin does not gain access to other shoppers' private claim identities or shopping lists.

## Future barcode feature

Wish records reserve optional fields for barcode and product image.

Later flow:

D1 product cache -> barcode provider A -> provider B -> provider C -> manual/photo fallback.

The barcode feature must not delay or complicate the initial blind-wishlist vertical slice.