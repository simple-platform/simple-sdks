# Simple Platform SDKs

> **Official SDKs for the Simple Platform** — Build powerful, type-safe logic modules with AI, GraphQL, HTTP, and security capabilities

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D25-brightgreen.svg)](https://nodejs.org)

---

## Overview

Welcome to the **Simple Platform SDK monorepo** — a collection of official SDKs that enable developers to build sophisticated logic modules on the Simple Platform. This repository contains SDKs for multiple programming languages, all compiled to WebAssembly for optimal performance and security.

### Multi-Language Support

| Language       | Status         | Documentation               |
| -------------- | -------------- | --------------------------- |
| **TypeScript** | ✅ Available   | [View Docs](sdks/ts#readme) |
| **Go**         | 🚧 Coming Soon | `sdks/go`                   |
| **Python**     | 🚧 Coming Soon | `sdks/python`               |

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
- **⚡ WASM Performance**: Optimized for the Simple Platform's high-performance runtime

---

## Quick Start

### TypeScript

```bash
pnpm add @simple/sdk
```

```typescript
import simple from '@simple/sdk'

simple.Handle(async (request) => {
  const data = request.parse<{ name: string }>()
  return { message: `Hello, ${data.name}!` }
})
```

**[→ View full TypeScript SDK documentation](sdks/ts#readme)**

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

   This automatically installs:
   - Node.js 25.2.1
   - Rust 1.90.0 (for WASM tooling)
   - pnpm (via Corepack)

3. **Install dependencies**:

   ```bash
   pnpm install
   ```

4. **Build all SDKs**:

   ```bash
   cd sdks/ts
   pnpm build
   ```

### Monorepo Structure

```
simple-sdks/
├── sdks/
│   ├── ts/              # TypeScript SDK
│   │   ├── src/         # Source files
│   │   ├── dist/        # Compiled output
│   │   └── README.md    # TypeScript SDK docs
│   ├── go/              # Go SDK (coming soon)
│   └── python/          # Python SDK (coming soon)
├── devbox.json          # Devbox configuration
├── pnpm-workspace.yaml  # Workspace configuration
└── package.json         # Root package
```

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
- `fix(sdk-go):` Go SDK fixes
- `docs(sdk-py):` Python SDK documentation

**Examples:**

```bash
git commit -m "feat(sdk-ts): add streaming AI response support"
git commit -m "fix(sdk-ts): resolve GraphQL mutation error handling"
git commit -m "docs: update monorepo setup instructions"
git commit -m "refactor(sdk-go): delete deprecated utilities"
```

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
