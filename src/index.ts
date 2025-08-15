import { BetterAuthError } from "better-auth";
import type { BetterAuthPlugin } from "better-auth/plugins";

export type AttioPluginOptions = {
	secret: string;
};

export const attio = (opts: AttioPluginOptions) => {
	if (!opts.secret) {
		throw new BetterAuthError("[Attio Plugin] Missing secret");
	}

	return {
		id: "attio",
	} satisfies BetterAuthPlugin;
};
