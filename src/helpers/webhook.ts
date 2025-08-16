import type { Adapter } from "better-auth";
import * as crypto from "node:crypto";

export const validateWebhookSignature = async (
	adapter: Adapter,
	signature: string,
	body: string,
): Promise<boolean> => {
	// get all webhook integrations
	const integrations = await adapter.findMany({
		model: "attioIntegration",
	});

	// check signature against each integration's webhookSecret
	for (const integration of integrations) {
		const hmac = crypto.createHmac("sha256", integration.webhookSecret);
		hmac.update(body);
		const expectedSignature = hmac.digest("hex");

		if (
			crypto.timingSafeEqual(
				Buffer.from(signature),
				Buffer.from(expectedSignature),
			)
		) {
			return true;
		}
	}

	return false;
};