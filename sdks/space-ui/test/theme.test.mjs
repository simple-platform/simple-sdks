/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('declares the light color scheme on the root', async () => {
  const theme = await readFile(new URL('../theme.css', import.meta.url), 'utf8')
  const lightDefaults = theme.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''

  assert.match(lightDefaults, /(?:^|[;\n])\s*color-scheme:\s*light;/)
})

test('declares the dark color scheme on the dark class', async () => {
  const theme = await readFile(new URL('../theme.css', import.meta.url), 'utf8')
  const darkDefaults = theme.match(/\.dark\s*\{([^}]*)\}/)?.[1] ?? ''

  assert.match(darkDefaults, /(?:^|[;\n])\s*color-scheme:\s*dark;/)
})
