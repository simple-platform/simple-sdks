/**
 * Asserts that each shipping artifact declares exactly the imports its host binds.
 *
 * The crate builds two artifacts from one source, and the two hosts bind
 * different sets of names in the `simple` namespace. This reads the import
 * section out of each built module and holds it to the set its host provides,
 * so the guarantee rests on the modules themselves rather than on the builds
 * having been run.
 *
 * The modules come from `--examples` builds: the crate is a library, and linking
 * it into a binary is what emits a `.wasm` with an import section to read.
 *
 * Usage: node check-wasm-imports.mjs <server.wasm> <browser.wasm>
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

/** What the server host binds: a host call is answered synchronously. */
const SERVER = [
  '__call',
  '__cast',
  '__getContext',
  '__getContextSize',
  '__getExecutionResult',
  '__getExecutionResultSize',
]

/**
 * What the browser worker binds.
 *
 * It answers a host call by parking the module and resuming it later, so the
 * reply arrives through `set_response_buffer` rather than through an
 * execution-result pair. The `async` feature is what leaves that pair out of the
 * import section.
 */
const BROWSER = ['__call', '__cast', '__getContext', '__getContextSize']

/** The names a module asks for in the `simple` namespace, sorted. */
function simpleImports(path) {
  const module = new WebAssembly.Module(readFileSync(path))

  return WebAssembly.Module.imports(module)
    .filter(entry => entry.module === 'simple')
    .map(entry => entry.name)
    .sort()
}

function check(label, path, expected) {
  const actual = simpleImports(path)
  const wanted = [...expected].sort()

  if (actual.join() === wanted.join()) {
    console.log(`  ok  ${label}: ${actual.length} imports — ${actual.join(', ')}`)

    return true
  }

  const missing = wanted.filter(name => !actual.includes(name))
  const extra = actual.filter(name => !wanted.includes(name))

  console.error(`  FAIL  ${label} (${path})`)
  console.error(`        expected: ${wanted.join(', ')}`)
  console.error(`        actual:   ${actual.join(', ') || '(none)'}`)

  if (missing.length) {
    console.error(`        missing:  ${missing.join(', ')}`)
  }

  if (extra.length) {
    console.error(
      `        extra:    ${extra.join(', ')}`
      + '  <- outside the set this host binds',
    )
  }

  return false
}

const [server, browser] = process.argv.slice(2)

if (!server || !browser) {
  console.error('usage: node check-wasm-imports.mjs <server.wasm> <browser.wasm>')
  process.exit(2)
}

const results = [
  check('server artifact', server, SERVER),
  check('browser artifact', browser, BROWSER),
]

if (results.includes(false)) {
  process.exit(1)
}

// The two sets are required to differ as well, which is what confirms the
// feature reached the second build and that these are two distinct artifacts.
if (simpleImports(server).length === simpleImports(browser).length) {
  console.error('  FAIL  both artifacts declare the same imports; the async build did not differ')
  process.exit(1)
}

console.log('  both artifacts declare exactly the imports their host binds')
