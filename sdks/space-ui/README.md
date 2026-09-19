# Simple UI Kit

`@simpleplatform/ui-kit` is the supported UI boundary for Simple Spaces. It contains framework-neutral contracts, semantic theme variables, canonical Web Component entry points, and React bridges as they become supported.

## Current surface

This foundation intentionally exposes no product component. The supported imports are:

```ts
import { SIMPLE_THEME_VARIABLES } from '@simpleplatform/ui-kit/contracts'
import { StatusBadge } from '@simpleplatform/ui-kit/react'
import '@simpleplatform/ui-kit/theme.css'
```

`StatusBadge` is a React bridge for the canonical `<simple-status-badge>` Web Component. UI Kit components receive the explicit props they need; the package provides no implicit SDK client or React context. Future data-aware components may accept a public SDK client through an explicit prop when that is warranted by their contract.

## Theme contract

`theme.css` supplies development fallbacks for version 1 semantic `--simple-*` variables. A future Space host theme snapshot replaces those values at runtime. Consumers must use only variables listed by `SIMPLE_THEME_VARIABLES`; palette values, private component variables, and host CSS selectors are not public API.

## Development

```bash
pnpm --filter @simpleplatform/ui-kit typecheck
pnpm --filter @simpleplatform/ui-kit test
```

The package is versioned independently. A component may be added only with an explicit public contract, Element and React-bridge tests, accessibility coverage, and a deployed Space fixture.
