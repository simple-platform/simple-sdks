import type { Context } from './types'

import { execute as hostExecute } from './host'

/**
 * Creates a task through the platform task service.
 *
 * The task is assigned to the user the action is running as. The platform
 * creates both the task and its first message ids.
 */
export async function create(
  options: { taskTypeId: string, title: string, input: Record<string, unknown> },
  context: Context,
): Promise<{ task: { id: string, revision: number, status: string } }> {
  if (typeof options.taskTypeId !== 'string' || options.taskTypeId.trim() === '') {
    throw new Error('taskTypeId is required for task creation')
  }
  if (typeof options.title !== 'string' || options.title.trim() === '') {
    throw new Error('title is required for task creation')
  }
  if (options.input === null || typeof options.input !== 'object' || Array.isArray(options.input)) {
    throw new Error('input must be an object for task creation')
  }

  const response = await hostExecute('action:tasks/create', {
    input: options.input,
    task_type_id: options.taskTypeId,
    title: options.title,
  }, context)

  if (!response.ok) {
    throw new Error(response.error?.message ?? 'Task creation failed')
  }

  const data = response.data as { task?: { id?: unknown, revision?: unknown, status?: unknown } } | null | undefined
  if (data === null || typeof data !== 'object' || Array.isArray(data)
    || data.task === null || typeof data.task !== 'object' || Array.isArray(data.task)
    || typeof data.task.id !== 'string' || typeof data.task.revision !== 'number'
    || typeof data.task.status !== 'string') {
    throw new Error('Task creation response was not understood')
  }

  return { task: { id: data.task.id, revision: data.task.revision, status: data.task.status } }
}
