/* Generated-compatible Convex function builders. Regenerate with `npx convex dev` after provisioning. */
import {
  actionGeneric,
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
  type ActionBuilder,
  type HttpActionBuilder,
  type MutationBuilder,
  type QueryBuilder,
} from 'convex/server'
import type { DataModel } from './dataModel'

export const query = queryGeneric as QueryBuilder<DataModel, 'public'>
export const internalQuery = internalQueryGeneric as QueryBuilder<DataModel, 'internal'>
export const mutation = mutationGeneric as MutationBuilder<DataModel, 'public'>
export const internalMutation = internalMutationGeneric as MutationBuilder<DataModel, 'internal'>
export const action = actionGeneric as ActionBuilder<DataModel, 'public'>
export const internalAction = internalActionGeneric as ActionBuilder<DataModel, 'internal'>
export const httpAction = httpActionGeneric as HttpActionBuilder
