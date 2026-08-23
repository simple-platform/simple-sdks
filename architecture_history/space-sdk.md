# Embedded Space SDK Architecture

- **Status:** The foundation SDK is implemented through `simple.context`, `simple.records.current()`, `record.update()`, `record.submit()`, and `simple.data.query()` / `simple.data.mutate()`. Its browser bootstrap works in standalone and record contexts; record commands explain when no route-owned record exists. List context and public secondary-record APIs are deferred from this release.
- **Last updated:** 2026-08-10
- **Scope:** The browser-safe, framework-neutral SDK surface used by embedded Simple Spaces and its future portal-compatible transport boundary.
- **Out of scope:** The host record runtime, record-page layout, Space selection, customer-Space migration, React presentation components, and public-portal server implementation.

## Context

Simple has one published TypeScript SDK, `@simpleplatform/sdk`. Its package root is the Action/WASM API, while embedded Spaces need browser-safe APIs for accessing platform capabilities. Earlier Spaces copied a local MessagePort GraphQL client into each Space. That made fixes, error semantics, and migrations expensive, and it provided no behavior-aware record workflow.

The SDK must give a Space author simple, recognizable nouns without exposing host React state, auth tokens, Record Behavior source, or raw record-session internals. It also needs to remain usable by React, Vue, Svelte, and plain browser JavaScript, and be portable to a future public portal transport.

## Goals

1. Publish one TypeScript package: `@simpleplatform/sdk`.
2. Keep Action/WASM and browser APIs in explicit, safe entry points.
3. Provide a small framework-neutral Space client with clear nouns and verbs.
4. Preserve the platform-owned record workflow for form records, including Record Behaviors, validation, documents, authorization enforcement, and submit state.
5. Retain flexible application data access through a single SDK contract rather than copied bridge code.
6. Use transport abstractions so an iframe MessagePort and a future portal-session transport can implement the same public contracts.
7. Version and test public contracts before broad production-Space migration.

## Non-goals

- Publishing a second package such as `@simple/sdk`.
- Making browser globals available from the Action/WASM package root.
- Providing subscriptions, live events, or public `dispose()` before there is a real event source.
- Treating GraphQL mutation as a replacement for behavior-aware record updates.
- Exposing host `RecordSession` instances, route internals, cookies, or credentials to a Space.
- Publishing `simple.records.open()` or `record.close()` in the foundation release.
- Removing copied bridge support or modifying B&V Spaces without an approved migration plan.

## Engineering principles

### KISS

- Keep the first Space surface to `simple.records` and `simple.data`.
- Use obvious method names: `records.current`, `data.query`, `data.mutate`, `record.update`, and `record.submit`.
- Do not add aliases, subscriptions, lifecycle methods, or generic record abstractions until a concrete capability requires them.

### DRY

- The SDK serializes one versioned protocol rather than recreating host record logic.
- Existing GraphQL MessagePort support is reused by `simple.data`; it is not reimplemented as a second bridge.
- Browser and direct-adapter tests exercise the same public Space client.

### High cohesion and low coupling

- `src/space/core.ts` owns public types, validation, immutable snapshots, and the transport-neutral client.
- `src/space/index.ts` is the browser Space entry point and re-exports the core API.
- The platform owns authorization, Record Behaviors, persistence, and session lifecycle.
- A Space owns presentation and its own local UI state.

## Current-state findings

- `@simpleplatform/sdk` already owns the published TypeScript package and Action/WASM API.
- The package root must stay Action/WASM-only because importing browser globals from Actions is unsafe and invalid in the runtime.
- The host iframe bridge already carries `GRAPHQL_REQUEST` and `GRAPHQL_RESPONSE` over a dedicated MessagePort with parent-side authorization.
- The record protocol is negotiated through the existing `SPACE_READY` / `INIT_RPC` handshake and currently exposes the route's primary record only.
- The Space client deliberately receives snapshots rather than host state stores. Snapshots are immutable and replaceable after each command response.
- Production B&V Spaces still use copied GraphQL bridge clients, plus in some cases identity, navigation, decryption, and theme helpers. They are not yet migrated.
- `connectSpace()` establishes the general Space transport even when the host does not negotiate record protocol v1. `simple.data` remains available in that environment; `simple.records.current()` rejects with a structured `unavailable` error only when invoked.
- The host explicitly supplies a `SpaceContext` during `INIT_RPC`: currently `standalone` or `record`. The SDK rejects a missing or malformed context rather than deriving page state from browser data. List context is deferred until a custom list body exists.

## Target architecture

```text
@simpleplatform/sdk
├── package root                 Action/WASM API only
├── /space                      framework-neutral Space client
│   ├── simple.records           behavior-aware form records
│   └── simple.data              flexible authorized application data
└── /space                      iframe MessagePort bootstrap, adapter, and core API

Embedded Space
└── BrowserSpaceTransport
    ├── SPACE_PROTOCOL_REQUEST / RESPONSE  -> host RecordSession commands
    └── GRAPHQL_REQUEST / RESPONSE          -> host-authorized GraphQL bridge

Future public portal
└── PortalSessionTransport
    └── same /space public client, server-issued capability scope
```

The browser adapter multiplexes record-protocol and GraphQL responses on one dedicated `MessagePort`. It does not make the public record API dependent on the iframe protocol; another adapter can satisfy the same transport interfaces later.

An embedded Space does not need a record route to use the SDK. Record protocol negotiation is an optional capability of the general browser transport.

The connection also exposes the host-supplied context:

```ts
type SpaceContext
  = | { kind: 'standalone' }
    | {
      kind: 'record'
      applicationId: string
      tableName: string
      recordId: string
    }
```

There is intentionally no inferred or `unknown` context variant. Context is descriptive page information, while `records.current()` remains the route-owned primary session with the shared behavior, validation, error, dirty-state, and header lifecycle.

## Ownership and security boundaries

| Owner         | Responsibility                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDK           | Public types, request construction, response validation, snapshot immutability, structured client errors, and browser MessagePort adaptation.                      |
| Platform host | Handshake/origin checks, capability negotiation, record-session lookup, permission enforcement, Record Behavior execution, persistence, and GraphQL authorization. |
| Server        | Tenant, record, field, action, and data authorization; authoritative data validation and mutation enforcement.                                                     |
| Space author  | Rendering snapshots and errors, choosing permitted application-data operations, and calling record commands for record workflow writes.                            |

No presentation capability is an authorization boundary. The host and server validate every command and GraphQL operation.

## Public primitives and contracts

### Imports

```ts
import type { RecordHandle, RecordSnapshot } from '@simpleplatform/sdk/space'
import { connectSpace } from '@simpleplatform/sdk/space'
```

### Connection and primary record

```ts
const simple = await connectSpace({ targetOrigin: new URL(document.referrer).origin })
const record = await simple.records.current()

await record.update({ first_name: 'Ada' })
const result = await record.submit()
const snapshot = record.snapshot()
```

`record.update()` stages completed field values and returns the host's new snapshot. `record.submit()` runs the canonical platform workflow and returns `{ ok, snapshot }`; expected validation failures are results rather than bypassable client state.

### Flexible application data

```ts
const users = await simple.data.query<{ users: Array<{ id: string }> }>(
  `query Users { users: dev_simple_system__users(limit: 10) { id } }`,
)

await simple.data.mutate(
  `mutation CreateNote($body: String!) { insert_demo__note(object: { body: $body }) { id } }`,
  { body: 'Follow up.' },
)
```

`simple.data` is a supported, first-class capability for separately authorized application data. A write to the record managed by a form must use `record.update()` and `record.submit()` so behavior, validation, documents, and shared header state remain intact.

### Errors and lifecycle

- `SpaceProtocolError` represents malformed, unsupported, denied, or closed record-protocol operations.
- `SpaceDataError` represents unavailable/closed data transport or a host GraphQL failure.
- The primary record belongs to the route and has no public close method.
- Internal MessagePort teardown is implementation cleanup. Public `record.close()` begins only with secondary-record support.

## Code and package layout

```text
simple-sdks/
├── architecture_history/
│   └── space-sdk.md
└── sdks/ts/
    ├── src/space/core.ts        public transport-neutral client and contracts
    ├── src/space/index.ts       browser MessagePort adapter and public entry
    ├── test/space-record.test.mjs
    ├── test/space-browser.test.mjs
    ├── package.json             explicit ./space export
    └── README.md                public usage guidance
```

## Delivery plan and stopping points

1. **Primary record read bridge — complete.** Negotiate protocol v1, open the current record, validate opaque handles, and expose immutable snapshots.
2. **Primary record update and submit — complete.** Use host-owned behavior and persistence sequencing; validate field/form feedback and header parity.
3. **Unify package and flexible data access — complete.** Publish the `@simpleplatform/sdk/space` subpaths, provide `simple.data`, and prove the deployed fixture can make a safe read without regressing the record API.
4. **Secondary records — deferred.** Do not add preparatory runtime code or publish `simple.records.open()` / `record.close()` until this work is explicitly resumed with a concrete host and authorization design.
5. **Production bridge migration — not started.** Inventory each B&V Space capability, migrate in bounded groups to the SDK, browser-validate each group, and only then consider retiring copied bridge code.
6. **Public portal transport — not started.** Add a server-issued portal session adapter that exposes the same contracts under portal-specific capability grants.

Every step ends with focused automated contract tests and a browser checkpoint before the next public capability is added.

## Validation and rollout

- Build and typecheck `@simpleplatform/sdk` before consuming it from a Space fixture.
- Contract-test request envelopes, response validation, immutable snapshots, record results, data-request multiplexing, and structured bridge failures.
- Build and test the internal `record-protocol` fixture against the current local SDK package.
- Deploy the fixture to the internal local tenant and verify the platform header/body boundary, `simple.data.query()` success, staged record update, default-view recovery, and browser console/network health.
- Keep GraphQL mutation browser checks out of the fixture when a contract test proves serialization; browser validation should not create fixture data unnecessarily.
- Migrate production Spaces only after a written capability-by-capability migration plan and rollback path.

## Risks and open questions

### Risks

- **Record workflow bypass:** Documentation and SDK examples must keep record writes on `simple.records`; host enforcement remains authoritative.
- **Transport drift:** New transports must satisfy existing contract tests rather than change the public client shape.
- **Copied bridge migration:** Production Spaces use more capabilities than data access. Removing bridge handlers before a migration inventory would cause customer regressions.
- **Versioned asset mismatch:** Deployment manifests must be built after their app version is written; otherwise the host can resolve a Space asset path that was never uploaded.

### Open questions

1. Which data operations will a future portal session permit, and how are those scopes declared per Space?
2. What record-loader API and ownership model are needed for `simple.records.open()`?
3. When a reliable event source exists, what ordering and replay contract should a subscription API provide?
4. Which non-record bridge capabilities—identity, navigation, decryption, documents, AI, and theme—need first-class SDK namespaces before B&V migration begins?
5. What release lanes and compatibility policy will govern published `@simpleplatform/sdk/space` versions?

## Decision history

### 2026-08-09 — One package with explicit environment subpaths

- **Decision:** Consolidate the embedded Space APIs into `@simpleplatform/sdk/space` and `@simpleplatform/sdk/space/browser`; keep the package root Action/WASM-only.
- **Reason:** Developers install one SDK while explicit imports prevent accidental browser/Action runtime mixing.
- **Supersedes:** The staging `@simple/sdk` package and the public `simple.page.primaryRecord()` naming.

### 2026-08-09 — Small noun-led Space API

- **Decision:** Use `simple.records` for behavior-aware form records and `simple.data` for flexible authorized application data. The primary-record entry point is `simple.records.current()`.
- **Reason:** The names tell a developer which contract to choose without a deep hierarchy or duplicate aliases.

### 2026-08-09 — Record lifecycle remains host-owned

- **Decision:** Expose immutable snapshots plus `update()` and `submit()` for the current record; do not expose subscriptions, public `dispose()`, or `close()` for it.
- **Reason:** The host owns the route session and Simple does not yet have a reliable live-event source. Secondary lifecycle starts only with secondary records.

### 2026-08-09 — Preserve flexible data access in the unified SDK

- **Decision:** Provide `simple.data.query()` and `simple.data.mutate()` through the existing secured GraphQL MessagePort bridge, mapping failures to `SpaceDataError`.
- **Reason:** It is a useful first-class capability and gives existing Spaces a migration path away from copied bridge clients without adding a parallel transport.
- **Boundary:** This does not authorize bypassing the form record workflow; record-form writes remain `record.update()` and `record.submit()`.

### 2026-08-09 — Portal compatibility is transport-level, not API-level

- **Decision:** A future public portal uses a server-issued, capability-scoped transport that implements the same Space client contracts.
- **Reason:** The public API remains portable while portal authentication, routing, and authorization stay server controlled.

### 2026-08-09 — Secondary records start with host ownership, not a speculative SDK method

- **Decision:** Do not add `simple.records.open()` until the platform has an internal per-Space session registry plus a real host loader that creates fully configured, independently submit-capable record sessions. The registry is an internal platform concern; it does not widen the public SDK yet.
- **Reason:** An opaque handle is only meaningful when the host owns its authorization, behavior, persistence, and cleanup lifecycle. Publishing `open()` earlier would either create an incomplete contract or duplicate React form orchestration in the browser API.
- **Implementation and validation:** The internal registry now accepts loader-owned session options, creates only secondary handles, keeps each session and submit adapter isolated, refuses to close the primary route handle, and disposes all owned sessions on iframe teardown. Focused host/runtime tests pass. It remains entirely internal: no SDK method or browser GraphQL loader was added.

### 2026-08-09 — Freeze the foundation SDK at the primary-record contract

- **Decision:** Ship only `simple.records.current()`, `record.update()`, `record.submit()`, and `simple.data.query()` / `simple.data.mutate()` in the foundation release. Defer `simple.records.open()` and `record.close()`.
- **Reason:** The primary-record contract is browser-validated and useful on its own. Secondary records require a separate authorization, document, Activity, and lifecycle rollout that should not delay or complicate the foundation.
- **Boundary:** Retain internal registry/loader work as unpublished preparation. Do not add protocol messages, browser SDK methods, examples, or migration guidance for secondary records until the work is explicitly resumed.

### 2026-08-09 — Report embedded Space height without widening the public API

- **Decision:** After the existing v1 handshake succeeds, `connectSpace()` automatically reports the iframe document height to its parent and observes later size changes when `ResizeObserver` is available.
- **Reason:** On record pages the host can let the iframe grow to its contents and keep a single platform-owned page scrollbar. Authors do not need a new API call, and standalone iframe hosts can ignore the report.
- **Boundary:** The report is a small postMessage layout signal, not a record protocol operation or public SDK capability. It is sent only to the already configured parent origin, deduplicates unchanged sizes, and does not change `simple.records` or `simple.data`.
- **Validation:** The browser bridge contract test covers the initial report, and package build/tests pass.

### 2026-08-10 — Keep iframe sizing outside the Space SDK

- **Decision:** Remove automatic content-height reporting from `connectSpace()`.
- **Reason:** The record host now gives its iframe a flex-sized remaining viewport below the platform header, so browser CSS—not a cross-origin postMessage signal—controls the iframe size. This removes an SDK responsibility that is neither a Space capability nor needed by the handshake.
- **Boundary:** A Space still controls its own document scrolling within the iframe. No public API or record/data transport behavior changes.
- **Supersedes:** The 2026-08-09 content-height reporting decision.

### 2026-08-10 — Make standalone Space transport the SDK baseline

- **Decision:** `connectSpace()` succeeds for every embedded Space with a valid MessagePort. Record protocol negotiation is optional: `simple.data` works with the general bridge, and `simple.records.current()` throws `SpaceProtocolError` code `unavailable` only when the host did not provide a route-owned record session.
- **Reason:** Data-only dashboards, tools, and future portal surfaces should use the same published SDK rather than retain copied bridge clients. An optional record capability must not make otherwise supported SDK functions unavailable.
- **Boundary:** Browser bootstrapping still requires an embedded browser and a valid host MessagePort. The SDK does not invent a record session for standalone Spaces, and record writes remain behavior-aware record commands whenever a record session exists.

### 2026-08-10 — Return explicit host context from every Space connection

- **Decision:** `connectSpace()` returns `simple.context`, a discriminated `SpaceContext` supplied by the host in the `INIT_RPC` handshake. Its only allowed variants are `standalone`, `list`, and `record`; list provides `applicationId` and `tableName`, while record also provides `recordId`. Missing or malformed context rejects the connection with `SpaceProtocolError` code `invalid_response`.
- **Reason:** Future list Spaces and public-portal transports need unambiguous page facts without URL guessing. Returning that information from the connection keeps the Space client simple and makes a host's declared capability boundary observable to an author.
- **Boundary:** Context does not create or locate a record session. `simple.records.current()` remains necessary because it refers to the host-owned current record session, including behavior sequencing, validation feedback, dirty state, and the platform header's shared lifecycle. `simple.records.open()` remains deferred.

### 2026-08-10 — One documented browser connection entry point

- **Decision:** Use `connectSpace()` as the only documented browser bootstrap, imported from `@simpleplatform/sdk/space/browser`. New scaffolds call it directly rather than generating a copied bridge or adding a second bootstrap name.
- **Reason:** A single explicit name keeps examples, migrations, and support guidance aligned with the published package contract.
- **Boundary:** This does not change the SDK's capability surface or force a bulk rewrite of existing Spaces. Their copied bridge remains only as staged migration compatibility until each unsupported capability has a public replacement.

### 2026-08-10 — Defer list context until list Spaces exist

- **Decision:** The current documented `SpaceContext` has only `standalone` and `record` variants. Do not document or rely on a `list` variant until Simple supports a custom list body and the host provides that context.
- **Reason:** Listing unsupported variants makes the public contract look more complete than the deployed host implementation and encourages code paths no current Space can exercise.
- **Supersedes:** The earlier planning decision that included a list context variant in the foundation contract.

### 2026-08-10 — Make `/space` the complete browser entry point

- **Decision:** Space authors import `connectSpace()` and all Space types from `@simpleplatform/sdk/space`. Internally, `src/space/core.ts` remains transport-neutral and `src/space/index.ts` owns the browser handshake. Do not publish a second `/space/browser` alias.
- **Reason:** One import path is easier to learn and removes an artificial distinction for the only currently implemented Space environment, while the internal core/browser boundary remains cohesive and portal-ready.
- **Protocol cleanup:** The private operation is `record.current`, matching the public `simple.records.current()` name. The current context union contains only `standalone` and `record`.
- **Scope cleanup:** Remove the unused delete capability and unpublished secondary-record preparation from the foundation. Deferred features should add their infrastructure when their actual host, authorization, and lifecycle contracts are approved.
- **Supersedes:** The documented `/space/browser` bootstrap, the staging `page.primaryRecord` wire name, and decisions to retain preparatory secondary-record runtime code.

### 2026-08-10 — Keep the public Space export smaller than its transport internals

- **Decision:** Export `connectSpace()`, the supported client/record/context types, and structured errors from `@simpleplatform/sdk/space`. Keep protocol envelopes, transports, request factories, and protocol version constants internal to the package.
- **Reason:** Space authors need the capability API, not the MessagePort implementation. Publishing transport plumbing would create compatibility obligations without a supported use case.

### 2026-08-10 — Remove the fabricated update capability

- **Decision:** Remove `RecordSnapshot.capabilities.canUpdate` from the foundation SDK.
- **Reason:** The host route does not yet supply authoritative permission state, so the field always reported `true`. Omitting it is more accurate than exposing guessed security metadata.
- **Boundary:** Host and server authorization continue to reject unauthorized writes. A future capability field requires a real shared permission source and contract tests for both allowed and denied states.
