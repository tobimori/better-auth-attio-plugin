import type { AuthContext, EndpointContext, Method } from "better-auth";
import { z } from "zod";
import type { AttioPluginOptions } from "../index";

export const validateSecret = (
	opts: AttioPluginOptions,
	ctx: EndpointContext<
		string,
		{
			method: Method;
			body: z.ZodObject<{
				secret: z.ZodString;
			}>;
		},
		AuthContext
	>,
) => {
	const secret = opts.secret || ctx.context.secret;
	if (secret && ctx.body.secret !== secret) {
		return ctx.error("UNAUTHORIZED");
	}
	return null;
};