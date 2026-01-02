/**
 * @file Simple Platform Security SDK
 *
 * This module provides the global-style, fluent API for authoring security policies
 * in a standard JavaScript (`.js`) file. It is designed to be executed by the
 * platform's "Smart Compiler" (a Record Behavior) to produce a declarative
 * JSON artifact.
 */

// ============================================================================
// Internal State & Types
// ============================================================================

/**
 * A module-level array that will hold the compiled policies after the user's
 * security manifest script has been executed.
 * @internal
 */
const _compiledPolicies: Policy[] = []

// --- Type Definitions for the SDK Grammar ---

export type FilterCondition = Record<string, any>

export interface Grant {
  '*'?: boolean | Rule | Rule[]
  'aggregate'?: {
    allow?: {
      avg?: boolean | string[]
      count?: boolean
      max?: boolean | string[]
      min?: boolean | string[]
      sum?: boolean | string[]
    }
    allowRawData?: boolean
    filter?: Rule | Rule[]
  }
  'create'?: boolean | Rule | Rule[]
  'delete'?: boolean | Rule | Rule[]
  'edit'?: boolean | Rule | Rule[]
  'inherits'?: string[]
  'read'?: boolean | Rule | Rule[]
}

export interface GrantsObject {
  [roleName: string]: Grant
}

export interface LookupConfig {
  filter?: Record<string, any>
  resource: string
  select: string
}

/**
 * The final, declarative JSON artifact for a single policy.
 * @internal
 */
export interface Policy {
  grants: GrantsObject
  resource: string
}

export interface Rule {
  check?: {
    condition: FilterCondition
    errorMessage: string
  }
  columns?: { except: string[] }
  filter?: FilterCondition
  preset?: Record<string, any>
}

// ============================================================================
// Global SDK Functions for Policy Authoring
// ============================================================================

declare global {
  /**
   * Logically combines multiple rules with an AND condition.
   * An array of rules `[rule1, rule2]` is shorthand for `and(rule1, rule2)`.
   */
  function and(...rules: Rule[]): { _and: Rule[] }

  /**
   * Creates a validation rule for mutations.
   * If the condition is met, the mutation is allowed. If not, the transaction
   * is rejected with the provided error message.
   * @param errorMessage The error message to return if the check fails.
   * @param condition The filter-style condition object to validate.
   */
  function check(errorMessage: string, condition: FilterCondition): Rule

  /**
   * A helper for column-level security that denies access to specific fields.
   * @param fields A list of field names to hide.
   */
  function deny(...fields: string[]): { columns: { except: string[] } }

  /**
   * Creates a lookup rule for filtering against an unrelated resource.
   * This is translated into a subquery by the SQLCompiler.
   * @param config The lookup configuration.
   * @example
   * // Restrict access to projects where the current user is a team member.
   * const rule = {
   *   filter: {
   *     id: {
   *       _in: lookup({
   *         resource: 'my_app/table/project_member',
   *         select: 'project_id',
   *         filter: { user_id: { _eq: '$user.id' } }
   *       })
   *     }
   *   }
   * };
   */
  function lookup(config: LookupConfig): any

  /**
   * Negates a rule.
   */
  function not(rule: Rule): { _not: Rule }

  /**
   * Logically combines multiple rules with an OR condition.
   */
  function or(...rules: Rule[]): { _or: Rule[] }

  /**
   * Defines a security policy for a specific resource.
   * @param resourceName The full name of the target resource, following the pattern `app_id/table/resource_name` or `app_id/logic/resource_name`.
   * @param grantsObject An object defining the permissions for each role.
   * @example
   * // Define reusable rule constants for clarity
   * const when = {
   *   isOwner: { filter: { creator_id: { _eq: '$user.id' } } },
   *   isDraft: { filter: { status: { _eq: 'Draft' } } }
   * };
   *
   * const hide = {
   *   financials: deny('rate', 'commission')
   * };
   *
   * // Define a policy for the 'booking' table in the 'crm' app
   * policy('crm/table/booking', {
   *   // Agents can read their own bookings and we hide financial fields.
   *   agent: {
   *     read: [when.isOwner, hide.financials],
   *     create: true, // Can create new bookings
   *     edit: [when.isOwner, when.isDraft] // Can only edit their own bookings if they are in draft status
   *   },
   *
   *   // Managers have full access to all bookings.
   *   manager: {
   *     '*': true // Wildcard for all permissions
   *   },
   *
   *   // Finance users have limited, read-only aggregation rights.
   *   finance: {
   *     read: false, // Cannot read individual booking records
   *     aggregate: {
   *       allowNodes: false, // Cannot view the raw data rows
   *       allow: {
   *         count: true,
   *         sum: ['amount', 'commission'] // Can only sum these specific numeric fields
   *       }
   *     }
   *   }
   * });
   *
   * // Define a policy for a logic/action resource
   * policy('crm/logic/send_invoice', {
   *   // Only managers and agents can execute this action.
   *   manager: { execute: true },
   *   agent: { execute: true }
   * });
   */
  function policy(resourceName: string, grantsObject: GrantsObject): void
}

globalThis.policy = (resourceName: string, grantsObject: GrantsObject): void => {
  _compiledPolicies.push({
    grants: grantsObject,
    resource: resourceName,
  })
}

globalThis.lookup = (config: LookupConfig): any => {
  // This function simply returns a structured object that the compiler can identify.
  return { $$isLookup: true, ...config }
}

globalThis.and = (...rules: Rule[]): { _and: Rule[] } => ({ _and: rules })
globalThis.or = (...rules: Rule[]): { _or: Rule[] } => ({ _or: rules })
globalThis.not = (rule: Rule): { _not: Rule } => ({ _not: rule })

globalThis.deny = (...fields: string[]): { columns: { except: string[] } } => {
  return { columns: { except: fields.flat() } }
}

globalThis.check = (errorMessage: string, condition: FilterCondition): Rule => {
  return {
    check: {
      condition,
      errorMessage,
    },
  }
}

// ============================================================================
// Internal Helpers for the Compiler
// ============================================================================

/**
 * Clears the internal policy array.
 * Called by the "Smart Compiler" to reset state between executions.
 * @internal
 */
export function clearCompiledPolicies(): void {
  _compiledPolicies.length = 0
}

/**
 * Retrieves the array of compiled policies.
 * Called by the "Smart Compiler" Record Behavior after executing the manifest.
 * @internal
 */
export function getCompiledPolicies(): Policy[] {
  return _compiledPolicies
}
