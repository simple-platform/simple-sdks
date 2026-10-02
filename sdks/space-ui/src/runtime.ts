export interface RuntimeDescriptor {
  url: string
  version: string
}

export interface RuntimeInfo {
  version: string
}

export interface RuntimeModule {
  version?: unknown
}

export class RuntimeLoadError extends Error {
  readonly expected: string
  readonly received?: string

  constructor(message: string, expected: string, received?: string) {
    super(message)
    this.name = 'RuntimeLoadError'
    this.expected = expected
    this.received = received
  }
}

const loads = new Map<string, Promise<RuntimeInfo>>()
const LOAD_TIMEOUT_MS = 15_000

/**
 * Loads one exact Simple UI Runtime artifact and shares the in-flight result.
 * The runtime module registers its elements as a side effect and exports its
 * version for an integrity check at the API boundary.
 */
export function loadRuntime({ url, version }: RuntimeDescriptor): Promise<RuntimeInfo> {
  const key = `${version}:${url}`
  const existing = loads.get(key)
  if (existing)
    return existing

  let timeout: ReturnType<typeof setTimeout> | undefined
  const load = Promise.race([
    import(/* @vite-ignore */ url).then(module => readRuntimeInfo(module, version)),
    new Promise<RuntimeInfo>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new RuntimeLoadError(
        'The Simple UI Runtime did not load in time.',
        version,
      )), LOAD_TIMEOUT_MS)
    }),
  ])
    .finally(() => {
      if (timeout !== undefined)
        clearTimeout(timeout)
    })
    .catch((error: unknown) => {
      loads.delete(key)
      throw error
    })

  loads.set(key, load)
  return load
}

function readRuntimeInfo(module: RuntimeModule, expected: string): RuntimeInfo {
  if (typeof module.version !== 'string' || module.version !== expected) {
    throw new RuntimeLoadError(
      `Simple UI Runtime version mismatch. Expected ${expected}.`,
      expected,
      typeof module.version === 'string' ? module.version : undefined,
    )
  }

  return { version: module.version }
}
