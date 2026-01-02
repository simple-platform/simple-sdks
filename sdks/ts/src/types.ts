/** The complete execution context for an action. */
export interface Context {
  logic: Logic
  tenant: Tenant
  user: User
}

/**
 * Represents the metadata handle for a file securely stored in the platform.
 * This JSON object is the "pointer" to the file and is stored in `:document` fields.
 */
export interface DocumentHandle {
  /** The SHA-256 hash of the file content, used as the unique content-addressable key. */
  file_hash: string

  /** The original name of the file when it was uploaded. */
  filename: string

  /** The type of the file, e.g., "application/pdf". */
  mime_type: string

  /** The size of the file in bytes. */
  size: number

  /** The storage path where the file is stored. */
  storage_path: string
}

/** Represents the source configuration for downloading an external file. */
export interface ExternalFileSource {
  /** Optional authentication configuration for accessing the external file. */
  auth?: {
    /** Bearer token for bearer authentication. */
    bearer_token?: string

    /** Password for basic authentication. */
    password?: string

    /** The type of authentication to use. */
    type: 'basic' | 'bearer'

    /** Username for basic authentication. */
    username?: string
  }

  /** The URL of the external file to download. */
  url: string
}

/** Contains metadata about the specific logic execution. */
export interface Logic {
  execution_env: string
  execution_id: string
  id: string
  trigger_id: string
}

/** Error structure for host communication responses. */
export interface SimpleError {
  message: string
  reasons?: string[]
}

/** The low-level request structure sent by the host to an action. */
export interface SimpleRequest {
  context: Context
  data?: string // The data payload is a JSON string
  headers: Record<string, any>
}

/** The low-level response structure for host communication. */
export interface SimpleResponse<T = any> {
  data?: T
  error?: SimpleError
  ok: boolean
}

/** Represents the target location for storing an uploaded file. */
export interface StorageTarget {
  /** The application ID where the file will be stored. */
  app_id: string

  /** The field name where the DocumentHandle will be stored. */
  field_name: string

  /** The table name where the record exists. */
  table_name: string
}

/** Represents tenant information in the execution context. */
export interface Tenant {
  host?: string
  id?: string
  name: string
}

/** Represents user information in the execution context. */
export interface User {
  id?: string
}
