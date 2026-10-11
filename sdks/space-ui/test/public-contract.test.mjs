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

test('ships local typography and semantic token defaults without component-specific variables', async () => {
  const theme = await readFile(new URL('../theme.css', import.meta.url), 'utf8')
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

  assert.equal('SIMPLE_THEME_CONTRACT_VERSION' in contracts, false)
  assert.equal('SIMPLE_THEME_VARIABLES' in contracts, false)
  assert.match(theme, /--simple-font-size-2xs:\s*0\.625rem;/)
  assert.match(theme, /--simple-color-status-success-background:/)
  assert.match(theme, /--simple-color-accent-1:/)
  assert.match(theme, /--simple-color-text-primary:/)
  assert.match(theme, /--simple-color-overlay-backdrop:\s*hsl\(0 0% 0% \/ 80%\);/)
  assert.match(theme, /--simple-color-canvas:\s*hsl\(0 0% 100%\);/)
  assert.match(theme, /--simple-sidebar-width:\s*16rem;/)
  const darkDefaults = theme.match(/\.dark\s*\{([^}]*)\}/)?.[1]
  assert.ok(darkDefaults, 'standalone spaces should provide dark-mode token fallbacks')
  assert.match(darkDefaults, /--simple-color-canvas:\s*hsl\(240 10% 3\.9%\);/)
  assert.match(darkDefaults, /--simple-color-action-primary:\s*#0070DD;/)
  const lightDefaults = theme.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
  const lightBackdrop = lightDefaults.match(/--simple-color-overlay-backdrop:\s*([^;]+);/)?.[1]
  const darkBackdrop = darkDefaults.match(/--simple-color-overlay-backdrop:\s*([^;]+);/)?.[1] ?? lightBackdrop
  assert.equal(lightBackdrop, 'hsl(0 0% 0% / 80%)')
  assert.equal(darkBackdrop, 'hsl(0 0% 0% / 80%)')
  assert.match(theme, /--simple-content-width-2xl:\s*96rem;/)
  assert.match(theme, /--simple-gradient-action-primary:\s*none;/)
  assert.doesNotMatch(theme, /--simple-status-badge-/)
  assert.match(theme, /@import ['"]@fontsource-variable\/geist['"]/)
  assert.match(theme, /@import ['"]@fontsource-variable\/geist-mono['"]/)
  assert.match(theme, /--simple-font-family-sans:\s*'Geist Variable',\s*ui-sans-serif,\s*system-ui,\s*sans-serif;/)
  assert.match(theme, /--simple-font-family-mono:\s*'Geist Mono Variable',\s*ui-monospace,\s*SFMono-Regular,\s*Menlo,\s*monospace;/)
  assert.doesNotMatch(theme, /--simple-font-family-sans:\s*var\(--font-sans/)
  assert.doesNotMatch(theme, /--simple-font-family-mono:\s*var\(--font-mono/)
  assert.match(theme, /--color-background:\s*var\(--simple-color-canvas\);/)
  assert.match(theme, /--color-card:\s*var\(--simple-color-surface-raised\);/)
  assert.match(theme, /--color-foreground:\s*var\(--simple-color-text-primary\);/)
  assert.match(theme, /--color-primary:\s*var\(--simple-color-action-primary\);/)
  assert.match(theme, /--background-image-action-primary-gradient:\s*var\(--simple-gradient-action-primary\);/)
  assert.match(theme, /--color-canvas:\s*var\(--simple-color-canvas\);/)
  assert.match(theme, /--color-surface:\s*var\(--simple-color-surface\);/)
  assert.match(theme, /--color-overlay-backdrop:\s*var\(--simple-color-overlay-backdrop\);/)
  assert.match(theme, /@media \(min-width: 96rem\)\s*\{\s*\.container\s*\{\s*max-width: var\(--simple-content-width-2xl\);/)
  assert.match(theme, /--color-status-success:\s*var\(--simple-color-status-success\);/)
  assert.match(theme, /--font-sans:\s*var\(--simple-font-family-sans\);/)
  assert.match(theme, /--font-mono:\s*var\(--simple-font-family-mono\);/)
  assert.match(theme, /--text-2xs:\s*var\(--simple-font-size-2xs\);/)
  assert.match(theme, /--text-base:\s*var\(--simple-font-size-md\);/)
  assert.match(theme, /--text-3xl:\s*var\(--simple-font-size-3xl\);/)
  assert.match(theme, /--font-weight-bold:\s*var\(--simple-font-weight-bold\);/)
  assert.match(theme, /--leading-normal:\s*var\(--simple-line-height-normal\);/)
  assert.match(theme, /--tracking-tight:\s*var\(--simple-letter-spacing-tight\);/)
  assert.match(theme, /--spacing-4:\s*var\(--simple-space-4\);/)
  assert.match(theme, /--height-control-md:\s*var\(--simple-control-height-md\);/)
  assert.match(theme, /--height-icon-sm:\s*var\(--simple-icon-size-sm\);/)
  assert.match(theme, /--size-icon-lg:\s*var\(--simple-icon-size-lg\);/)
  assert.match(theme, /--container-content-2xl:\s*var\(--simple-content-width-2xl\);/)
  assert.match(theme, /--width-sidebar:\s*var\(--simple-sidebar-width\);/)
  for (const [breakpoint, token] of [
    ['40', 'sm'],
    ['48', 'md'],
    ['64', 'lg'],
    ['80', 'xl'],
    ['96', '2xl'],
  ]) {
    assert.match(theme, new RegExp(`@media \\(min-width: ${breakpoint}rem\\)\\s*\\{\\s*\\.container\\s*\\{\\s*max-width: var\\(--simple-content-width-${token}\\);`))
  }
  assert.match(theme, /\.lucide:is\([^\n]*\[class~='size-4'\]/)
  assert.match(theme, /height: var\(--simple-icon-size-sm\);\s*width: var\(--simple-icon-size-sm\);/)
  assert.match(theme, /--radius:\s*var\(--simple-radius-md\);/)
  assert.match(theme, /--radius-md:\s*var\(--simple-radius-md\);/)
  assert.match(theme, /--shadow-sm:\s*var\(--simple-shadow-sm\);/)
  assert.match(theme, /--shadow-md:\s*var\(--simple-shadow-md\);/)
  assert.ok(packageJson.sideEffects.includes('./theme.css'))
  assert.equal(packageJson.dependencies['@fontsource-variable/geist'], '5.2.9')
  assert.equal(packageJson.dependencies['@fontsource-variable/geist-mono'], '5.2.8')
})

test('publishes only the supported prop-driven UI Kit bridges', () => {
  assert.equal('loadRuntime' in root, false)
  assert.equal('RuntimeLoadError' in root, false)
  assert.equal(typeof react.StatusBadge, 'function')
  assert.equal(typeof react.RecordForm, 'function')
  assert.equal(typeof react.RecordActivity, 'function')
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
    assert.equal(typeof packedReact.RecordActivity, 'function')
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
