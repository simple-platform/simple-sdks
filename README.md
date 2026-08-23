# Simple Platform SDKs

> **Official SDKs for the Simple Platform** — Build powerful, type-safe logic modules with AI, GraphQL, HTTP, and security capabilities

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D25-brightgreen.svg)](https://nodejs.org)

---

## Overview

Welcome to the **Simple Platform SDK monorepo** — a collection of official SDKs that enable developers to build sophisticated logic modules on the Simple Platform. This repository contains SDKs for multiple programming languages, all compiled to WebAssembly for optimal performance and security.

### Multi-Language Support

| Language       | Package                        | Status         | Documentation                 |
| -------------- | ------------------------------ | -------------- | ----------------------------- |
| **TypeScript** | npm `@simpleplatform/sdk`      | ✅ Available   | [View Docs](sdks/ts#readme)   |
| **Rust**       | crates.io `simpleplatform-sdk` | ✅ Available   | [View Docs](sdks/rust#readme) |
| **Go**         | —                              | 🚧 Coming Soon | `sdks/go`                     |
| **Python**     | —                              | 🚧 Coming Soon | `sdks/python`                 |

The two package names are not the same shape because the two registries are not.
npm has scopes and crates.io does not, so `@simpleplatform/sdk` has no crates.io
equivalent and the Rust crate takes the bare name `simpleplatform-sdk`.

All SDKs provide a **unified API surface** with consistent patterns across languages, enabling developers to leverage the Simple Platform's powerful primitives regardless of their language preference.

---

## Features

The Simple Platform SDKs provide first-class support for:

- **🤖 AI Operations**: Extract structured data, summarize content, and transcribe audio/video with advanced language models
- **📊 GraphQL Integration**: Query and mutate data with a type-safe GraphQL client
- **🌐 HTTP Utilities**: Make external API calls with a clean, promise-based interface
- **🔐 Security Policies**: Author declarative, role-based access control with a fluent API
- **⚙️ Settings Management**: Access application configuration securely
- **📁 Storage Operations**: Upload and manage files with content-addressable storage
- **🧾 Embedded Record Spaces**: Use behavior-aware record workflows through the browser-safe Space entry point
- **⚡ WASM Performance**: Optimized for the Simple Platform's high-performance runtime

---

## Quick Start

### TypeScript

```bash
pnpm add @simpleplatform/sdk
```

```typescript
import simple from '@simpleplatform/sdk'

simple.Handle(async (request) => {
  const data = request.parse<{ name: string }>()
  return { message: `Hello, ${data.name}!` }
})
```

**[→ View full TypeScript SDK documentation](sdks/ts#readme)**

### Rust

```bash
cargo add simpleplatform-sdk
```

```rust
use simpleplatform_sdk::prelude::*;

#[derive(Deserialize, Schema)]
struct Input {
    /// Who to greet.
    #[simple(length(min = 1, max = 80))]
    name: String,
}

#[derive(Serialize)]
struct Output {
    message: String,
}

/// Greet someone by name.
///
/// @tool
/// @shortdesc Greet someone by name.
/// @usewhen A caller wants a greeting for a person.
fn handler(request: Request<Input>) -> Result<Output, Error> {
    Ok(Output {
        message: format!("Hello, {}!", request.data.name),
    })
}

fn main() { simple::run(handler) }
```

Build it and run its tests with the platform CLI:

```bash
simple build com.mycompany.crm/greet
simple test com.mycompany.crm -a greet
```

No lifetimes, no `async`, no `unsafe`, no envelope, one import line. The handler
is a plain `fn`, what the action is and what it accepts are written in the doc
comments beside it, and its tests run on the host with no wasm and no emulator.

**[→ View full Rust SDK documentation](sdks/rust#readme)**

### Go (Coming Soon)

Stay tuned for the Go SDK release!

### Python (Coming Soon)

Stay tuned for the Python SDK release!

---

## Development

### Prerequisites

This monorepo uses [Devbox](https://www.jetify.com/devbox) to manage development dependencies consistently across all contributors.

#### Install Devbox

```bash
curl -fsSL https://get.jetify.com/devbox | bash
```

### Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/simple-platform/simple-sdks.git
   cd simple-sdks
   ```

2. **Start the Devbox shell**:

   ```bash
   devbox shell
   ```

   This installs Node.js, Rust and the `wasm32-wasip1` target, and enables pnpm
   via Corepack. The versions are the ones `devbox.json` pins; they are
   deliberately not repeated here, because a version written down in two places
   is a version that drifts. CI reads the Rust one out of `devbox.json` for the
   same reason.

3. **Install dependencies**:

   ```bash
   pnpm install
   ```

4. **Build the TypeScript SDK**:

   ```bash
   cd sdks/ts
   pnpm build
   ```

5. **Check the Rust SDK**:

   ```bash
   cd sdks/rust
   cargo test                                # host; no wasm, no emulator
   cargo clippy --all-targets -- -D warnings
   cargo build --target wasm32-wasip1 --release --examples
   ```

   `sdks/rust` is a two-crate workspace — the SDK and the `Schema` derive in
   `macros/` — and one command from that directory covers both.
   `sdks/rust/README.md` lists the full check set, and
   `.github/workflows/rust-sdk-test.yml` runs exactly that set.

   An action author needs none of this: `simple build` and `simple test` are the
   commands, and `sdks/rust/README.md` opens with them.

### Monorepo Structure

```
simple-sdks/
├── sdks/
│   ├── ts/              # TypeScript SDK  -> npm @simpleplatform/sdk
│   │   ├── src/         # Source files
│   │   ├── dist/        # Compiled output
│   │   └── README.md    # TypeScript SDK docs
│   ├── rust/            # Rust SDK        -> crates.io simpleplatform-sdk
│   │   ├── src/         # Source files
│   │   ├── macros/      # The Schema derive -> crates.io simpleplatform-sdk-macros
│   │   ├── examples/    # Ported actions; also the acceptance tests
│   │   ├── tests/       # Wire-bytes and public-surface guarantee suites
│   │   ├── Cargo.toml   # Workspace, crate manifest and publish metadata
│   │   └── README.md    # Rust SDK docs
│   ├── go/              # Go SDK (coming soon)
│   └── python/          # Python SDK (coming soon)
├── .github/workflows/
│   ├── release.yml            # Versioning and publishing, one lane per SDK
│   └── rust-sdk-test.yml      # The Rust gate
├── devbox.json          # Devbox configuration; the toolchain versions live here
├── pnpm-workspace.yaml  # Workspace configuration (sdks/rust is excluded)
└── package.json         # Root package
```

`sdks/rust` is a cargo crate, not a pnpm package: it is outside the pnpm
workspace, eslint does not walk into it beyond its README and manifest, and
`target/` is gitignored.

### Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository** and create a feature branch
2. **Make your changes** following the existing code style
3. **Run linting**:
   ```bash
   pnpm lint
   ```
4. **Test your changes** thoroughly
5. **Commit with Commitizen** (recommended):
   ```bash
   git cz
   ```
   Or manually using conventional commits:
   ```bash
   git commit -m "feat(sdk-ts): add streaming AI response support"
   ```
6. **Submit a pull request** with a clear description

#### Commit Guidelines

This project uses [Conventional Commits](https://www.conventionalcommits.org/) with component scopes:

**Commit Types:**

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Test additions or updates
- `chore:` Build/tooling changes

**Component Scopes:**

For SDK-specific changes, use component names:

- `feat(sdk-ts):` TypeScript SDK features
- `feat(sdk-rust):` Rust SDK features
- `fix(sdk-go):` Go SDK fixes
- `docs(sdk-py):` Python SDK documentation

**Examples:**

```bash
git commit -m "feat(sdk-ts): add streaming AI response support"
git commit -m "fix(sdk-ts): resolve GraphQL mutation error handling"
git commit -m "feat(sdk-rust): add the settings host call"
git commit -m "docs: update monorepo setup instructions"
git commit -m "refactor(sdk-go): delete deprecated utilities"
```

**The scope decides which SDK releases.** Each SDK has its own version lane in
`release.yml`, keyed on the files a commit touched and tagged in its own
namespace — `v1.2.3-ts` for TypeScript, `v1.2.3-rust` for Rust. A commit that
touches only `sdks/ts` cannot publish the crate, and a commit that touches only
`sdks/rust` cannot publish the npm package.

---

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.

---

## Support

- **Documentation**: [docs.simple.dev](https://docs.simple.dev)
- **Issues**: [GitHub Issues](https://github.com/simple-platform/simple-sdks/issues)
- **Community**: [Discord](https://discord.gg/NB33jQA9js)

---

**Built with ❤️ for the Simple Platform community**
