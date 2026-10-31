import type { MutateOptions } from '@tanstack/react-query'

export * from '@tanstack/react-query'
export { createAppQueryClient, type MutationMeta } from './client'

export type MutationCallbacks<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
> = MutateOptions<TData, TError, TVariables, TContext>
