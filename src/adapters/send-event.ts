import type {AuthContext} from "better-auth"
import type {AttioPluginOptions} from "../index.js"
import type {ModelAdapter, SyncEvent} from "./types.js"

export const sendWebhookEvent = async (
  event: SyncEvent,
  data: Record<string, unknown>,
  modelAdapter: ModelAdapter,
  ctx: AuthContext,
  opts: AttioPluginOptions
) => {
  try {
    const attioData = await modelAdapter.toAttio(event, data, ctx)
    if (!attioData) {
      return // Adapter chose not to sync this event
    }

    const webhooks = await ctx.adapter.findMany({
      model: "attioIntegration",
    })

    const promises = webhooks.map(async (webhook: any) => {
      try {
        // TODO: might have to replace w/ better-fetch
        const response = await fetch(webhook.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event,
            data: attioData,
            timestamp: new Date().toISOString(),
            adapter: {
              betterAuthModel: modelAdapter.betterAuthModel,
              attioObject: modelAdapter.attioObject,
              attioSchema: modelAdapter.attioSchema,
            },
          }),
        })

        if (!response.ok) {
          console.error(`Webhook delivery failed: ${response.status}`)
        }
      } catch (error) {
        console.error("Failed to deliver webhook to Attio:", error)
      }
    })

    if (opts.waitUntil) {
      opts.waitUntil(Promise.all(promises))
    } else {
      await Promise.all(promises)
    }
  } catch (error) {
    console.error("Error sending webhooks:", error)
  }
}
