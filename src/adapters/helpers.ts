import type {ModelAdapter} from "./types"
import {defaultAdapters} from "./index"

export function getAdapters(userAdapters?: ModelAdapter[]): ModelAdapter[] {
  const adapters: ModelAdapter[] = []
  const userAdapterModels = new Set(userAdapters?.map((a) => a.betterAuthModel) || [])

  for (const defaultAdapter of defaultAdapters) {
    if (!userAdapterModels.has(defaultAdapter.betterAuthModel)) {
      adapters.push(defaultAdapter)
    }
  }

  if (userAdapters) {
    adapters.push(...userAdapters)
  }

  return adapters
}

export function getAdapterByModel(
  adapters: ModelAdapter[],
  model: string
): ModelAdapter | undefined {
  return adapters.find((a) => a.betterAuthModel === model)
}

export function getAdaptersByAttioObject(adapters: ModelAdapter[], object: string): ModelAdapter[] {
  return adapters.filter((a) => a.attioObject === object)
}
