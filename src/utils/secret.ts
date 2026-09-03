import type {GenericEndpointContext} from "better-auth"
import type {AttioPluginOptions} from "../index.js"

export const validateSecret = (
  opts: AttioPluginOptions,
  ctx: GenericEndpointContext & {body: {secret: string}}
) => {
  const secret = opts.secret || ctx.context.secret
  if (secret && ctx.body.secret !== secret) {
    return ctx.error("UNAUTHORIZED")
  }
  return null
}
