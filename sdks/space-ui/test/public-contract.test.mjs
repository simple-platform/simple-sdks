/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const contracts = await import(new URL('../dist/contracts/index.js', import.meta.url).href)
const root = await import(new URL('../dist/index.js', import.meta.url).href)
const react = await import(new URL('../dist/react/index.js', import.meta.url).href)

test('ships local typography and StatusBadge defaults without defining the future token contract', async () => {
  const theme = await readFile(new URL('../theme.css', import.meta.url), 'utf8')
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

  assert.equal('SIMPLE_THEME_CONTRACT_VERSION' in contracts, false)
  assert.equal('SIMPLE_THEME_VARIABLES' in contracts, false)
  assert.match(theme, /--simple-status-badge-success-background:/)
  assert.doesNotMatch(theme, /--simple-color-text-primary:/)
  assert.match(theme, /@import ['"]@fontsource-variable\/geist['"]/)
  assert.match(theme, /@import ['"]@fontsource-variable\/geist-mono['"]/)
  assert.match(theme, /--font-sans:\s*'Geist Variable',\s*ui-sans-serif,\s*system-ui,\s*sans-serif/)
  assert.match(theme, /--simple-status-badge-font-family:\s*var\(--font-sans/)
  assert.ok(packageJson.sideEffects.includes('./theme.css'))
  assert.equal(packageJson.dependencies['@fontsource-variable/geist'], '5.2.9')
  assert.equal(packageJson.dependencies['@fontsource-variable/geist-mono'], '5.2.8')
})

test('publishes only the supported prop-driven UI Kit bridges', () => {
  assert.equal('loadRuntime' in root, false)
  assert.equal('RuntimeLoadError' in root, false)
  assert.equal(typeof react.StatusBadge, 'function')
  assert.equal(typeof react.RecordForm, 'function')
  assert.equal('SimpleProvider' in react, false)
  assert.equal('useSimpleClient' in react, false)
})

test('packs and imports every supported public entry point without private source files', async () => {
  const packageRoot = new URL('..', import.meta.url)
  const destination = await mkdtemp(join(tmpdir(), 'simple-ui-kit-pack-'))

  try {
    execFileSync('pnpm', ['pack', '--pack-destination', destination], {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    const [tarball] = await readdir(destination)
    assert.ok(tarball?.endsWith('.tgz'), 'pnpm pack should produce one tarball')

    const archive = join(destination, tarball)
    const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
    const packedPackage = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }))

    assert.equal(packedPackage.name, '@simpleplatform/ui-kit')
    assert.ok(packedPackage.sideEffects.includes('./theme.css'))
    assert.equal(packedPackage.dependencies['@fontsource-variable/geist'], '5.2.9')
    assert.equal(packedPackage.dependencies['@fontsource-variable/geist-mono'], '5.2.8')
    assert.deepEqual(Object.keys(packedPackage.exports), [
      '.',
      './contracts',
      './elements',
      './react',
      './theme.css',
      './package.json',
    ])

    for (const file of [
      'package/dist/index.js',
      'package/dist/contracts/index.js',
      'package/dist/elements/index.js',
      'package/dist/react/index.js',
      'package/dist/runtime.js',
      'package/theme.css',
      'package/custom-elements.json',
    ]) assert.ok(files.includes(file), `${file} must be published`)

    assert.ok(files.every(file => !file.startsWith('package/src/') && !file.startsWith('package/test/')))
    assert.equal(files.includes('package/dist/react/provider.js'), false)

    execFileSync('tar', ['-xzf', archive, '-C', destination])
    const require = createRequire(import.meta.url)
    const reactDirectory = dirname(require.resolve('react'))
    const packedNodeModules = join(destination, 'node_modules')
    await mkdir(packedNodeModules)
    await symlink(reactDirectory, join(packedNodeModules, 'react'), 'dir')
    await mkdir(join(packedNodeModules, '@simpleplatform'))
    await symlink(new URL('../../ts', import.meta.url), join(packedNodeModules, '@simpleplatform/sdk'), 'dir')

    const packedContracts = await import(pathToFileURL(join(destination, 'package/dist/contracts/index.js')).href)
    const packedElements = await import(pathToFileURL(join(destination, 'package/dist/elements/index.js')).href)
    const packedReact = await import(pathToFileURL(join(destination, 'package/dist/react/index.js')).href)
    const packedRuntime = await import(pathToFileURL(join(destination, 'package/dist/runtime.js')).href)

    assert.equal('SIMPLE_THEME_CONTRACT_VERSION' in packedContracts, false)
    assert.equal(typeof packedElements.SimpleStatusBadge, 'function')
    assert.equal(typeof packedReact.StatusBadge, 'function')
    assert.equal(typeof packedRuntime.loadRuntime, 'function')
    assert.equal(typeof packedReact.RecordForm, 'function')
  }
  finally {
    await rm(destination, { force: true, recursive: true })
  }
})

test('declares the public StatusBadge in the Custom Elements Manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../custom-elements.json', import.meta.url), 'utf8'))

  assert.equal(manifest.$schema, 'https://raw.githubusercontent.com/webcomponents/custom-elements-manifest/master/schema.json')
  assert.equal(manifest.schemaVersion, '1.0.0')
  assert.deepEqual(manifest.modules.map(module => module.path), ['dist/elements/status-badge.js'])
  assert.equal(manifest.modules[0].declarations[0].tagName, 'simple-status-badge')
})
