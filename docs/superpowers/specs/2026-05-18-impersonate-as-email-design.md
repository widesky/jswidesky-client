# Design: `impersonateAsEmail` and email support for `client.impersonateAs`

**Date:** 2026-05-18
**Status:** Approved (pending implementation plan)

## Summary

Extend `WideSkyClient` impersonation so callers may identify the target user by their account email instead of the entity UUID. Today, `impersonateAs(userId)` is synchronous and takes the WideSky user-entity UUID. This change adds an asynchronous helper that resolves an email to its user UUID by looking up the matching `account` entity and reading its `userRef` tag, then defers to the existing sync method.

The same email-or-UUID acceptance is extended to the `options.client.impersonateAs` construction option, with resolution deferred to the first authenticated request so the synchronous constructor contract is preserved.

## Motivation

Callers integrating WideSky as a downstream service often know the human-identifying email of the user they want to act on behalf of, but not the user-entity UUID. Today they must perform their own Haystack lookup before calling `impersonateAs`. Centralising that lookup removes duplicated boilerplate across consumers and ensures a single, tested path.

## API

### New direct method on `WideSkyClient`

Location: `src/client/client.js`, sibling to the existing `impersonateAs(userId)`.

```js
/**
 * Resolve a WideSky user by account email and impersonate as that user for all
 * subsequent requests. Authentication uses the client's configured credentials;
 * the lookup itself runs as that authenticated user (without impersonation),
 * after which impersonation applies to every subsequent request.
 *
 * @param email Email of the account whose user entity should be impersonated.
 * @returns {Promise<string>} The resolved user UUID now being impersonated.
 * @throws If no account matches the email, or the matched account entity has
 *         no `userRef` tag.
 */
async impersonateAsEmail(email) { ... }
```

Server-side email uniqueness is assumed (enforced by WideSky), so the lookup takes the first row of a `limit: 1` find.

### Updated `options.client.impersonateAs`

Existing schema field in `src/utils/evaluator.js` (`CLIENT_SCHEMA.impersonateAs`) keeps its `yup.string().nullable()` shape. Behaviour change:

- If the string contains `@`, treat it as an email and resolve lazily on the first request.
- Otherwise treat it as a user UUID exactly as today.

Documented in `docs/client/options.md`.

## Implementation

### `impersonateAsEmail`

```js
const HaystackTools = require('../utils/haystack');

async impersonateAsEmail(email) {
    const escaped = email.replaceAll('"', '\\"');
    const rows = await this.v2.find(`account and email=="${escaped}"`, 1);

    if (rows.length === 0) {
        throw new Error(`No account found for email ${email}`);
    }

    if (!rows[0].userRef) {
        throw new Error(`Account for ${email} has no userRef tag`);
    }

    const userId = HaystackTools.getId(rows[0], 'userRef');
    this.impersonateAs(userId);
    return userId;
}
```

Notes:
- `this.v2.find` returns the `rows` array of the Haystack response (defined in `src/client/functions/v2.js`).
- `HaystackTools.getId(entity, 'userRef')` (defined in `src/utils/haystack.js`) strips the `r:` prefix and any trailing display string, and validates that the tag exists and is a reference; the explicit `if (!rows[0].userRef)` block above provides a more descriptive error before that utility runs.

### Lazy resolution for `options.client.impersonateAs`

The `WideSkyClient` constructor calls `initClientOptions()` as a fire-and-forget async call. To preserve that contract while supporting email-based config, resolution is deferred to `_attachReqConfig`.

Add a private field:

```js
_impersonatePendingEmail = null;
```

In `initClientOptions`:

```js
if (this.clientOptions.impersonateAs !== null) {
    const value = this.clientOptions.impersonateAs;
    if (value.includes('@')) {
        this._impersonatePendingEmail = value;
    } else {
        this.impersonateAs(value);
    }
}
```

In `_attachReqConfig`, after the existing `await this.getToken()` and before the existing `if (this.isImpersonating())` header block:

```js
if (this._impersonatePendingEmail && !this._impersonate) {
    const pending = this._impersonatePendingEmail;
    this._impersonatePendingEmail = null;
    await this.impersonateAsEmail(pending);
}
```

Clearing `_impersonatePendingEmail` before the `await` is required to break recursion: the `v2.find` call inside `impersonateAsEmail` re-enters `_attachReqConfig`, and the inner call must see `pending == null` so it does not attempt the lookup again. The lookup request itself therefore runs as the authenticated configured user, with no `X-IMPERSONATE` header. Once it returns, `this._impersonate` is set and the outer triggering request — and every subsequent request — carries the resolved impersonation header.

### Request ordering

For an outer request that triggers lazy resolution:

1. `await this.getToken()` — authenticate with the configured username/password.
2. Pending email present → run `impersonateAsEmail(pending)`, which calls `this.v2.find(...)`. That nested request reuses the cached token and runs un-impersonated.
3. `this.impersonateAs(userId)` sets `_impersonate`.
4. The outer request attaches `X-IMPERSONATE: <userId>` and proceeds.
5. All subsequent requests skip the lookup and use the cached `_impersonate`.

## Tests

Mocha + chai + sinon + the `test/stubs.js` HTTP stub harness. New file: `test/client/internals/impersonateAsEmail.js`.

1. **Resolves user UUID from email.** Stub `v2.find` to return `[{ userRef: 'r:abc-123 Some Dis' }]`; assert `impersonateAs` is called with `'abc-123'`, `isImpersonating()` returns `true`, and the method resolves to `'abc-123'`.
2. **Throws on no match.** Stub `v2.find` to return `[]`; assert the rejection message is `No account found for email <email>`.
3. **Throws on missing `userRef`.** Stub `v2.find` to return `[{}]`; assert the rejection message is `Account for <email> has no userRef tag`.
4. **Email quote-escaping.** Call with `'foo"bar@x.com'`; assert the filter sent to `v2.find` contains `email=="foo\"bar@x.com"`.
5. **Lazy resolution via config.** Construct with `options.client.impersonateAs: 'user@example.com'`. Stub the HTTP layer to serve the token endpoint and the find. Issue one request and assert:
   - The token endpoint is hit first.
   - The find request carries the bearer token but **no** `X-IMPERSONATE` header.
   - The triggering request carries `X-IMPERSONATE: <resolved-uuid>`.
   - A second request also carries the header without re-running the find.
6. **UserId via config path unchanged.** Construct with `options.client.impersonateAs: '<uuid>'`; assert sync `impersonateAs` is invoked at init and no extra HTTP round-trip occurs before the first user request.

## Documentation and changelog

- `docs/client/api.md` — add a `WideSkyClient.impersonateAsEmail(email)` section directly after the existing `impersonateAs(userId)` entry, including parameter, return, and thrown-error tables.
- `docs/client/options.md` — update the `client.impersonateAs` row to: `A WideSky user ID or account email to impersonate requests as. If an email is supplied, the lookup runs on the first request.`
- `CHANGELOG.md` under `## [Unreleased]` — add an entry under `### Added` referencing the Jira ticket, e.g. `Added impersonateAsEmail and email support for the client.impersonateAs option.`

## Out of scope

- No change to the existing synchronous `impersonateAs(userId)` signature or behaviour.
- No `client.batch.*` variant.
- No cross-instance caching of email → UUID resolutions; each `WideSkyClient` instance resolves once on first use.
- No new error class — plain `Error` is used, consistent with existing constructor-level validation (`makeFromConfig`).
