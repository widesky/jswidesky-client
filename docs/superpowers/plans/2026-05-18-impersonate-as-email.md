# `impersonateAsEmail` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an async `impersonateAsEmail(email)` method on `WideSkyClient` that resolves a user account email to its user-entity UUID and impersonates as that user. Extend `options.client.impersonateAs` to accept either a UUID (current behaviour) or an email (lazy resolution on first request).

**Architecture:** New direct async method in `src/client/client.js` performs a `v2.find('account and email=="<email>"', 1)` Haystack lookup, validates the returned row has a `userRef` tag, extracts the UUID via the existing `HaystackTools.getId` utility, and delegates to the existing synchronous `impersonateAs(userId)`. Construction-time support is bolted onto `initClientOptions` (sets a `_impersonatePendingEmail` field when the configured value contains `@`) and resolved transparently from `_attachReqConfig` on the first authenticated request. Clearing the pending field before the lookup `await` prevents re-entry from the nested `v2.find` call.

**Tech Stack:** CommonJS, Node 16+, Mocha + chai + sinon, `test/stubs.js` HTTP-stub harness, `verifyRequestCall` helper in `test/client/utils.js`.

---

## Spec reference

This plan implements `docs/superpowers/specs/2026-05-18-impersonate-as-email-design.md`. Read it first.

## File map

- **Modify** `src/client/client.js`
  - Add field declaration `_impersonatePendingEmail` (alongside `_impersonate` at ~line 149).
  - Initialise `this._impersonatePendingEmail = null` in the constructor (alongside `this._impersonate = null` at ~line 193).
  - Branch in `initClientOptions` (~line 336): if `clientOptions.impersonateAs` contains `@`, set pending field; else call sync `impersonateAs` as today.
  - Add async `impersonateAsEmail(email)` method (immediately after `impersonateAs(userId)` at ~line 359).
  - In `_attachReqConfig` (~line 458): resolve pending email after `await this.getToken()` and before the existing `X-IMPERSONATE` header block.
  - Require `HaystackTools` at top of file (it is currently not required from `client.js`).
- **Create** `test/client/internals/impersonateAsEmail.js` — new test file modelled on existing `test/client/internals/impersonate.js`.
- **Modify** `docs/client/api.md` — add `WideSkyClient.impersonateAsEmail(email)` section after the existing `impersonateAs(userId)` entry.
- **Modify** `docs/client/options.md` — update the `client.impersonateAs` description.
- **Modify** `CHANGELOG.md` — add a line under `## [Unreleased]`.

## Working assumptions

- Branch already created (worktree branch `worktree-impersonate-as-email-spec`); commits target that branch.
- `npm install` already run; `node_modules/` populated.
- Use Node 16 (`.nvmrc`) for local execution.
- No lint to run; rely on existing `npm test` for verification.

---

## Task 1 — Add `impersonateAsEmail` method (red → green)

**Files:**
- Create: `test/client/internals/impersonateAsEmail.js`
- Modify: `src/client/client.js` (require + new method after `impersonateAs`)

### Step 1: Write the failing test file

Create `test/client/internals/impersonateAsEmail.js` with the following contents:

```js
/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 *
 * Unit tests for WideSkyClient.impersonateAsEmail
 */
"use strict";

const stubs = require('../../stubs'),
    sinon = require('sinon'),
    expect = require('chai').expect,
    WS_ACCESS_TOKEN = stubs.WS_ACCESS_TOKEN,
    WS_REFRESH_TOKEN = stubs.WS_REFRESH_TOKEN,
    getInstance = stubs.getInstance;

describe('client', () => {
    describe('impersonateAsEmail', () => {
        let http;
        let log;
        let ws;

        beforeEach(async () => {
            http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
            ws = getInstance(http, log);
            ws._wsRawSubmit = sinon.stub().callsFake((method, uri) => {
                if (uri === '/oauth2/token') {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                }
                return Promise.resolve('default response');
            });
        });

        it('resolves and sets the impersonation user id', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:abc-123 Some Dis' }
            ]);

            const resolved = await ws.impersonateAsEmail('alice@example.com');

            expect(resolved).to.equal('abc-123');
            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal('abc-123');
            expect(ws.v2.find.calledOnce).to.equal(true);
            expect(ws.v2.find.firstCall.args[0]).to.equal(
                'account and email=="alice@example.com"'
            );
            expect(ws.v2.find.firstCall.args[1]).to.equal(1);
        });

        it('throws when no account matches', async () => {
            sinon.stub(ws.v2, 'find').resolves([]);

            let err;
            try {
                await ws.impersonateAsEmail('missing@example.com');
            } catch (e) {
                err = e;
            }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal(
                'No account found for email missing@example.com'
            );
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('throws when matched account has no userRef tag', async () => {
            sinon.stub(ws.v2, 'find').resolves([{}]);

            let err;
            try {
                await ws.impersonateAsEmail('noref@example.com');
            } catch (e) {
                err = e;
            }
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal(
                'Account for noref@example.com has no userRef tag'
            );
            expect(ws.isImpersonating()).to.equal(false);
        });

        it('escapes double quotes in the email filter', async () => {
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:abc-123' }
            ]);

            await ws.impersonateAsEmail('foo"bar@example.com');

            expect(ws.v2.find.firstCall.args[0]).to.equal(
                'account and email=="foo\\"bar@example.com"'
            );
        });
    });
});
```

### Step 2: Run the new tests to verify they fail

Run: `npx mocha test/client/internals/impersonateAsEmail.js`

Expected: failures for all four tests, with errors like `TypeError: ws.impersonateAsEmail is not a function`.

### Step 3: Require `HaystackTools` at the top of `client.js`

Open `src/client/client.js`. After the existing `const bFormat = require("bunyan-format");` line (~line 20), add:

```js
const HaystackTools = require('../utils/haystack');
```

### Step 4: Add the `impersonateAsEmail` method

In `src/client/client.js`, immediately after the existing `impersonateAs(userId)` method (~line 361), insert:

```js
    /**
     * Resolve a WideSky user by account email and impersonate as that user
     * for all subsequent requests. Authentication uses the client's
     * configured credentials; the lookup itself runs as that authenticated
     * user (without impersonation). After it resolves, impersonation applies
     * to every subsequent request.
     *
     * @param email Email of the account whose user entity should be impersonated.
     * @returns {Promise<string>} The resolved user UUID now being impersonated.
     * @throws If no account matches the email, or the matched account entity
     *         has no `userRef` tag.
     */
    async impersonateAsEmail(email) {
        const escaped = email.replaceAll('"', '\\"');
        const rows = await this.v2.find(
            `account and email=="${escaped}"`,
            1
        );

        if (rows.length === 0) {
            throw new Error(`No account found for email ${email}`);
        }

        if (!rows[0].userRef) {
            throw new Error(
                `Account for ${email} has no userRef tag`
            );
        }

        const userId = HaystackTools.getId(rows[0], 'userRef');
        this.impersonateAs(userId);
        return userId;
    };
```

### Step 5: Run the new tests to verify they pass

Run: `npx mocha test/client/internals/impersonateAsEmail.js`

Expected: all four tests pass.

### Step 6: Run the full client internals suite to confirm no regressions

Run: `npx mocha test/client/internals/*.js`

Expected: existing impersonate and initClientOptions tests still pass.

### Step 7: Commit

```bash
git add src/client/client.js test/client/internals/impersonateAsEmail.js
git commit -m "feat(client): add impersonateAsEmail method"
```

---

## Task 2 — Lazy email resolution in `initClientOptions` and `_attachReqConfig`

**Files:**
- Modify: `src/client/client.js`
- Modify: `test/client/internals/impersonateAsEmail.js` (append new `describe` block)

### Step 1: Write the failing tests

Append a new `describe('via options.client.impersonateAs', ...)` block to `test/client/internals/impersonateAsEmail.js`, inside the outer `describe('client')`. Place it directly after the existing `describe('impersonateAsEmail')` block:

```js
    describe('options.client.impersonateAs', () => {
        let http;
        let log;
        let ws;

        function stubHttp(client) {
            client._wsRawSubmit = sinon.stub().callsFake((method, uri, body, config) => {
                if (uri === '/oauth2/token') {
                    return Promise.resolve({
                        access_token: WS_ACCESS_TOKEN,
                        refresh_token: WS_REFRESH_TOKEN,
                        expires_in: Date.now() + 2000
                    });
                }
                return Promise.resolve('default response');
            });
        }

        beforeEach(() => {
            http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
        });

        it('treats an @-containing value as an email and resolves lazily on first request', async () => {
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'lazy@example.com' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);

            // After init, nothing should be impersonated yet.
            expect(ws.isImpersonating()).to.equal(false);
            expect(ws._impersonatePendingEmail).to.equal('lazy@example.com');

            // Stub the lookup helper (v2.find) used during lazy resolution.
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:resolved-uuid' }
            ]);

            await ws.submitRequest('GET', '/api/about');

            expect(ws.v2.find.calledOnce).to.equal(true);
            expect(ws._impersonatePendingEmail).to.equal(null);
            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal('resolved-uuid');

            // First call: token; later calls: lookup + about. The about
            // request must carry the X-IMPERSONATE header.
            const aboutCall = ws._wsRawSubmit.getCalls().find(
                (c) => c.args[1] === '/api/about'
            );
            expect(aboutCall, 'about call captured').to.not.equal(undefined);
            expect(aboutCall.args[3].headers['X-IMPERSONATE']).to.equal(
                'resolved-uuid'
            );
        });

        it('treats a non-email value as a user id (no lookup)', async () => {
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'plain-uuid' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);

            expect(ws.isImpersonating()).to.equal(true);
            expect(ws._impersonate).to.equal('plain-uuid');
            expect(ws._impersonatePendingEmail).to.equal(null);

            const findSpy = sinon.spy(ws.v2, 'find');
            await ws.submitRequest('GET', '/api/about');
            expect(findSpy.called).to.equal(false);
        });

        it('does not re-resolve on subsequent requests', async () => {
            ws = new (require('../../../src/client/client'))(
                stubs.WS_URI,
                stubs.WS_USER,
                stubs.WS_PASSWORD,
                stubs.WS_CLIENT_ID,
                stubs.WS_CLIENT_SECRET,
                log,
                undefined,
                { client: { impersonateAs: 'lazy@example.com' } }
            );
            await ws.initClientOptions();
            stubHttp(ws);
            sinon.stub(ws.v2, 'find').resolves([
                { userRef: 'r:resolved-uuid' }
            ]);

            await ws.submitRequest('GET', '/api/about');
            await ws.submitRequest('GET', '/api/about');

            expect(ws.v2.find.callCount).to.equal(1);
        });
    });
```

### Step 2: Run the new tests to verify they fail

Run: `npx mocha test/client/internals/impersonateAsEmail.js`

Expected: the four Task-1 tests still pass; the three new tests fail (the assertions on `_impersonatePendingEmail` and lazy behaviour have no corresponding implementation yet).

### Step 3: Add the `_impersonatePendingEmail` field declaration

In `src/client/client.js`, locate the class field declarations (~lines 140–149). After the line:

```js
    _impersonate        // The user id which the original user is impersonating as.
```

add:

```js
    _impersonatePendingEmail        // Email queued for lazy impersonation resolution.
```

### Step 4: Initialise the pending field in the constructor

In the constructor (~line 193), find:

```js
        this._impersonate = null;
```

Add immediately after:

```js
        this._impersonatePendingEmail = null;
```

### Step 5: Branch on `@` in `initClientOptions`

In `src/client/client.js`, replace the existing block (~line 336):

```js
        if (this.clientOptions.impersonateAs !== null) {
            this.impersonateAs(this.clientOptions.impersonateAs);
        }
```

with:

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

### Step 6: Resolve pending email in `_attachReqConfig`

In `src/client/client.js`, locate `_attachReqConfig` (~line 458). After the existing `const token = await this.getToken();` line and before the `config = Object.assign({}, config);` line, insert:

```js
        if (this._impersonatePendingEmail && !this._impersonate) {
            const pending = this._impersonatePendingEmail;
            this._impersonatePendingEmail = null;
            await this.impersonateAsEmail(pending);
        }
```

(Clearing `_impersonatePendingEmail` before the `await` is required to break re-entry: the nested `v2.find` request inside `impersonateAsEmail` re-enters `_attachReqConfig`, and the inner call must see `pending == null` to skip the lookup.)

### Step 7: Run the new tests to verify they pass

Run: `npx mocha test/client/internals/impersonateAsEmail.js`

Expected: all seven tests pass.

### Step 8: Run the full client internals suite

Run: `npx mocha test/client/internals/*.js`

Expected: all existing tests still pass. In particular `initClientOptions.js`'s `impersonateAs` accept-string test still passes (the string `"abc"` contains no `@`, so it follows the sync path unchanged).

### Step 9: Run the full project test suite

Run: `npm test`

Expected: full suite passes.

### Step 10: Commit

```bash
git add src/client/client.js test/client/internals/impersonateAsEmail.js
git commit -m "feat(client): support email in options.client.impersonateAs via lazy resolution"
```

---

## Task 3 — Documentation

**Files:**
- Modify: `docs/client/api.md`
- Modify: `docs/client/options.md`
- Modify: `CHANGELOG.md`

### Step 1: Add `impersonateAsEmail` section to `docs/client/api.md`

In `docs/client/api.md`, immediately after the existing `### WideSkyClient.impersonateAs(userId)` block (around line 231, after its `**Returns:** None` line), insert:

```markdown
### WideSkyClient.impersonateAsEmail(email)
**Description:** Resolve a WideSky user by account email and impersonate as that user
for subsequent requests. Performs a Haystack `find` for the matching `account` entity
and reads its `userRef` tag to obtain the user UUID, then delegates to
`impersonateAs`.  
**Parameters:**

| Param   | Description                                                  |  Type  |
|---------|--------------------------------------------------------------|:------:|
| `email` | Email of the account whose user entity should be impersonated. | String |

**Returns:** `Promise<String>` — the resolved user UUID now being impersonated.

**Throws:**
- `Error('No account found for email <email>')` when the lookup returns no rows.
- `Error('Account for <email> has no userRef tag')` when the matched account entity has no `userRef` tag.
```

Also add a corresponding entry under the table-of-contents block at the top of the file by inserting:

```markdown
    - [WideSkyClient.impersonateAsEmail(email)](#wideskyclientimpersonateasemailemail)
```

immediately after the existing `- [WideSkyClient.impersonateAs(userId)](#wideskyclientimpersonateasuserid)` line.

### Step 2: Update `docs/client/options.md`

In `docs/client/options.md`, find the `client` table row whose `Path from client` cell is `impersonateAs` (the row currently reads `A WideSky user ID to impersonate requests as.`). Replace its description cell with:

```
A WideSky user ID, or an account email, to impersonate requests as. If an email is supplied, the lookup runs on the first request issued.
```

### Step 3: Add a CHANGELOG entry

In `CHANGELOG.md`, under the existing `## [Unreleased]` block, add a new bullet (matching the existing style and ticket-link convention used by other entries):

```markdown
- [CORE-XXXX](https://widesky.atlassian.net/browse/CORE-XXXX): Added `impersonateAsEmail(email)`
  method on `WideSkyClient`, and accepted an email value for the `client.impersonateAs`
  option (resolved lazily on the first request).
```

If the implementing engineer knows the actual Jira ticket key, substitute it for both `CORE-XXXX` occurrences. Otherwise leave the placeholder for the PR author to fill in.

### Step 4: Sanity-check the docs render

Open `docs/client/api.md` and `docs/client/options.md` in a markdown previewer and confirm:
- The new TOC entry links to the new section.
- The new section formatting matches the surrounding tables.
- The options-table row still aligns; pipe-column widths are not load-bearing here but readability is.

(No build command exists for docs; this is a visual check only.)

### Step 5: Commit

```bash
git add docs/client/api.md docs/client/options.md CHANGELOG.md
git commit -m "docs: document impersonateAsEmail and email support in client.impersonateAs"
```

---

## Task 4 — Final verification

### Step 1: Run the full test suite

Run: `npm test`

Expected: full suite passes (JUnit report written to `report.xml`, which is git-ignored).

### Step 2: Run coverage

Run: `npm run coverage`

Expected: pass; check that the new `impersonateAsEmail` method appears as covered in the text summary.

### Step 3: Confirm clean working tree

Run: `git status`

Expected: only the worktree-tracked changes; no stray files in `dist/`, `report.xml`, `.nyc_output`, etc.

### Step 4: Push the branch and open a PR

Push the worktree branch and open a Bitbucket pull request targeting `develop` (per project convention). Title prefixed with the Jira key. Body summarises the change, lists the test plan, and links the design document at `docs/superpowers/specs/2026-05-18-impersonate-as-email-design.md`.

---

## Out of scope (do not implement)

- No change to the existing synchronous `impersonateAs(userId)` signature or behaviour.
- No `client.batch.*` variant.
- No cross-instance caching of email → UUID resolutions.
- No new error class — plain `Error` is used, consistent with existing constructor-level validation.
