import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const packageRoot = process.argv[2]
assert.ok(packageRoot, 'usage: check-managed-ui-sdk.mjs <unpacked-sdk-directory>')
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
assert.equal(manifest.name, '@simpleplatform/sdk')

// Check the built artifact's private bridge, not its advertised package version.
const { createSimpleClient } = await import(pathToFileURL(resolve(packageRoot, 'dist/space/core.js')).href)
const runtime = { url: 'https://example.invalid/runtime.js', version: 'release-check' }
const expected = { document: 'query ReleaseCheck { __typename }', variables: { check: true } }
const client = createSimpleClient({
  dataTransport: { execute: async (document, variables) => ({ document, variables }) },
  runtime,
})
const bridge = client[Symbol.for('@simpleplatform/sdk/space/managed-ui/v1')]
assert.equal(typeof bridge?.graphql, 'function', `${manifest.name}@${manifest.version} lacks the managed UI bridge.`)
assert.deepEqual(bridge.runtime, runtime)
assert.deepEqual(await bridge.graphql(expected.document, expected.variables), expected)
console.log(`${manifest.name}@${manifest.version}: managed UI bridge works.`)
