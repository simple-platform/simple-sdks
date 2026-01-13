#!/usr/bin/env node

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')

async function main() {
  // eslint-disable-next-line node/prefer-global/process
  const [entryPoint, outFile] = process.argv.slice(2)

  if (!entryPoint || !outFile) {
    console.error('Usage: simple-sdk-build <entryPoint> <outFile>')
    // eslint-disable-next-line node/prefer-global/process
    process.exit(1)
  }

  const entryPointAbs = path.resolve(entryPoint)
  const outFileAbs = path.resolve(outFile)

  /**
   * This is a local esbuild plugin to solve our specific problem.
   * It intercepts module resolution. When it sees a file inside the
   * @simpleplatform/sdk package trying to import the exact relative path './host',
   * it redirects the bundler to our worker-override.js script instead.
   * This is the robust way to swap implementations at build time.
   */
  const simpleSdkHostAliasPlugin = {
    name: 'simple-sdk-host-alias',
    setup(build) {
      // Find the absolute path to the SDK's dist directory.
      // We need this to check if an import is coming from our SDK.
      const sdkDistPath = path.dirname(require.resolve('@simpleplatform/sdk'))

      // The 'onResolve' hook intercepts module lookups.
      build.onResolve({ filter: /^\.\/host$/ }, (args) => {
        // `filter` matches the exact import path string: './host'.
        // `args.importer` is the absolute path of the file doing the import.

        // If the file doing the import is NOT inside our SDK's dist folder,
        // we ignore it and let esbuild handle it normally.
        if (!args.importer.startsWith(sdkDistPath)) {
          return
        }

        // It's a match! Redirect the import to our override file.
        const overridePath = path.resolve(__dirname, 'worker-override.js')
        return { path: overridePath }
      })
    },
  }

  // We will now create a temporary entry file that esbuild will use.
  // This allows us to bundle and minify everything in a single, efficient step.
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-sdk-build-'))
  const tempEntryFile = path.join(tempDir, 'entry.js')

  try {
    /**
     * This is the content of our new, dynamic entry point. It controls the
     * precise order of operations.
     */
    const entryPointContent = `
      // This is the only module we need to define the main handler.
      // The user's code will be bundled into it via the dynamic import.

      export default async function() {
        const channel = { promise: null };

        try {
          // STEP 1: Create the promise channel and place it on the global scope.
          globalThis.__SIMPLE_PROMISE_CHANNEL__ = channel;

          // STEP 2: Dynamically import the user's application. This is a critical change.
          // The 'import()' statement executes the user's top-level code, which will
          // call simple.Handle and populate the channel.promise.
          await import('${entryPointAbs.replace(/\\/g, '/')}');

          // STEP 3: Now that the user's code has run, check the channel for the promise.
          if (channel.promise) {
            // Await the promise to get the final result of the async handler.
            return await channel.promise;
          } else {
            console.warn('SDK build warning: simple.Handle was not called by the user application.');
            return undefined;
          }
        } finally {
          // STEP 4: Always clean up the global scope to maintain the sandbox.
          delete globalThis.__SIMPLE_PROMISE_CHANNEL__;
        }
      };
    `

    await fs.writeFile(tempEntryFile, entryPointContent)

    // Read the contents of the temp file to pass via stdin.
    const tempFileContents = await fs.readFile(tempEntryFile, 'utf8')

    // --- STAGE 1: Build the user's application and the wrapper together ---
    const appBundleResult = await esbuild.build({
      bundle: true,
      define: {
        __ASYNC_BUILD__: 'true',
        __IS_WORKER_BUILD__: 'true',
      },
      format: 'iife',
      globalName: '__SIMPLE_MAIN_HANDLER__', // Assign the IIFE result to a global
      minify: true, // Minify the entire bundle
      plugins: [simpleSdkHostAliasPlugin],
      stdin: {
        contents: tempFileContents,
        // eslint-disable-next-line node/prefer-global/process
        resolveDir: process.cwd(),
        sourcefile: 'simple-sdk-virtual-entry.js', // Provide a fake filename for better error messages
      },
      write: false,
    })

    // The result is a minified IIFE that returns our async handler function.
    const userScriptBundle = appBundleResult.outputFiles[0].text

    // The final script for the worker just needs to execute this handler.
    // The IIFE returns an object with a `default` property containing our async function.
    const finalWorkerScript = `
      ${userScriptBundle}
      return __SIMPLE_MAIN_HANDLER__.default();
    `

    // --- STAGE 2: Build the final WASM loader with the correctly-built user script injected ---
    await esbuild.build({
      bundle: true,
      define: {
        __ASYNC_BUILD__: 'true',
        // Inject the minified, wrapped script.
        __USER_SCRIPT_BUNDLE__: JSON.stringify(finalWorkerScript),
      },
      minify: true,
      outfile: outFileAbs,
      stdin: {
        contents: `import simple from '@simpleplatform/sdk'; simple.Handle(() => {});`,
        // eslint-disable-next-line node/prefer-global/process
        resolveDir: process.cwd(),
      },
    })

    console.log(`✅ Simple SDK async build successful! Output: ${outFile}`)
  }
  catch (error) {
    console.error('❌ Simple SDK async build failed:')
    console.error(error)

    // eslint-disable-next-line node/prefer-global/process
    process.exit(1)
  }
  finally {
    // Clean up the temporary directory
    await fs.rm(tempDir, { force: true, recursive: true })
  }
}

main()
