import assert from 'node:assert/strict'
import { copyFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../sdks/space-ui/test/fixtures/record-view-contract-v1.json', import.meta.url))
const platformRoot = process.argv[2]
assert.ok(platformRoot, 'usage: node scripts/sync-record-view-contract.mjs <simple-repo> [--check]')
const target = resolve(platformRoot, 'apps/platform_web/lib/record-runtime/__fixtures__/record-view-contract-v1.json')
if (process.argv[3] === '--check') {
  assert.equal(readFileSync(target, 'utf8'), readFileSync(source, 'utf8'), 'Contract fixtures differ. Run this command without --check to sync the platform mirror.')
  console.log('Record view contract fixtures match.')
}
else {
  assert.equal(process.argv[3], undefined, 'The only supported option is --check.')
  copyFileSync(source, target)
  console.log('Platform record view contract fixture synced from UI Kit.')
}
