import type { Context } from './types'

import { execute as hostExecute } from './host'

/**
 * Executes a GraphQL query with variables and returns the data directly.
 * This function communicates with the host system's database action and handles
 * JSON marshaling, response processing, and error handling internally.
 *
 * @param query The GraphQL query string to execute.
 * @param variables Query variables as a map or object.
 * @param context The execution context for the query.
 * @returns A promise that resolves with the GraphQL query result data.
 * @throws Will throw an error if the query fails or the host returns an error.
 */
export async function execute<T = any>(query: string, variables: any, context: Context): Promise<T> {
  if (!query) {
    throw new Error('query is required for GraphQL execution')
  }

  const response = await hostExecute('action:db/execute', { query, variables }, context)

  if (!response.ok) {
    // eslint-disable-next-line no-console
    console.log('[GraphQL] response.error:', JSON.stringify(response.error, null, 2))

    // eslint-disable-next-line no-console
    console.log('[GraphQL] response.data:', JSON.stringify(response.data, null, 2))

    throw new Error(response.error?.message ?? 'GraphQL query failed')
  }

  return response.data as T
}

/**
 * Executes a GraphQL mutation operation.
 * It will throw an error if a query operation is passed.
 *
 * @param mutation The GraphQL mutation string.
 * @param variables The variables for the mutation.
 * @param context The execution context.
 * @returns A promise that resolves with the mutation result.
 */
export async function mutate<T = any>(mutation: string, variables: any, context: Context): Promise<T> {
  if (!mutation.trim().startsWith('mutation')) {
    throw new Error('A query was passed to the `mutate` method. Use the `query` method instead.')
  }

  return execute<T>(mutation, variables, context)
}

/**
 * Executes a GraphQL query operation.
 * It will throw an error if a mutation operation is passed.
 *
 * @param query The GraphQL query string.
 * @param variables The variables for the query.
 * @param context The execution context.
 * @returns A promise that resolves with the query result.
 */
export async function query<T = any>(query: string, variables: any, context: Context): Promise<T> {
  if (query.trim().startsWith('mutation')) {
    throw new Error('A mutation was passed to the `query` method. Use the `mutate` method instead.')
  }

  return execute<T>(query, variables, context)
}
