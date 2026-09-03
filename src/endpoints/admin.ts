import {generateId, type AuthContext} from "better-auth"
import {createAuthEndpoint, getIP, getSessionFromCtx} from "better-auth/api"
import {deleteSessionCookie, expireCookie, setSessionCookie} from "better-auth/cookies"
import {type admin, type UserWithRole} from "better-auth/plugins"
import {defaultRoles as defaultAdminRoles} from "better-auth/plugins/admin/access"
import {z} from "zod"
import type {AttioPluginOptions} from "../index.js"
import {validateSecret} from "../utils/secret.js"

const IMPERSONATION_HANDOFF_TTL_SECONDS = 5 * 60
const IMPERSONATION_HANDOFF_PREFIX = "attio-impersonation:"

/**
 * Get the admin plugin from the auth context
 */
export const getAdminPlugin = (context: AuthContext) => {
  const plugin = context.options.plugins?.find((p) => p.id === "admin")
  return plugin as ReturnType<typeof admin>
}

/**
 * Admin-plugin specific endpoints
 */
export const endpoints = (opts: AttioPluginOptions) => ({
  /**
   * Get user details with admin-specific information
   */
  getUserDetails: createAuthEndpoint(
    "/attio/user-details",
    {
      method: "POST",
      body: z.object({
        secret: z.string(),
        userId: z.string(),
      }),
    },
    async (ctx) => {
      const error = validateSecret(opts, ctx)
      if (error) return error

      if (!getAdminPlugin(ctx.context)) {
        return ctx.error("NOT_IMPLEMENTED")
      }

      try {
        const user = (await ctx.context.internalAdapter.findUserById(
          ctx.body.userId
        )) as UserWithRole

        if (!user) {
          return ctx.error("NOT_FOUND")
        }

        // extract admin-specific fields from user record
        const banned = Boolean(user.banned)
        const bannedUntil = user.banExpires ? user.banExpires.toISOString() : null
        const banReason = user.banReason || null
        const role = user.role || "user"

        return ctx.json({
          banned,
          bannedUntil,
          banReason,
          role,
        })
      } catch {
        return ctx.error("INTERNAL_SERVER_ERROR")
      }
    }
  ),

  /**
   * Update user ban status
   */
  updateUserBanStatus: createAuthEndpoint(
    "/attio/update-ban-status",
    {
      method: "POST",
      body: z.object({
        secret: z.string(),
        userId: z.string(),
        banned: z.boolean(),
        banReason: z.string().nullable().optional(),
        banExpires: z.string().nullable().optional(), // ISO date string
      }),
    },
    async (ctx) => {
      const error = validateSecret(opts, ctx)
      if (error) return error

      if (!getAdminPlugin(ctx.context)) {
        return ctx.error("NOT_IMPLEMENTED")
      }

      try {
        await ctx.context.internalAdapter.updateUser(ctx.body.userId, {
          banned: ctx.body.banned,
          banReason: ctx.body.banReason ?? null,
          banExpires: ctx.body.banExpires ? new Date(ctx.body.banExpires) : null,
        })

        return ctx.json({
          success: true,
        })
      } catch {
        return ctx.error("INTERNAL_SERVER_ERROR")
      }
    }
  ),

  /**
   * Impersonate a user - creates a session token
   */
  impersonateUser: createAuthEndpoint(
    "/attio/impersonate",
    {
      method: "POST",
      body: z.object({
        secret: z.string(),
        targetUserId: z.string(), // the user to impersonate
        adminEmail: z.string(), // the admin's email from Attio (for tracking who impersonated)
      }),
    },
    async (ctx) => {
      const error = validateSecret(opts, ctx)
      if (error) return error

      if (!getAdminPlugin(ctx.context)) {
        return ctx.error("NOT_IMPLEMENTED")
      }

      try {
        const adminUser = await ctx.context.internalAdapter.findUserByEmail(
          ctx.body.adminEmail.toLowerCase()
        )
        if (!adminUser?.user) {
          return ctx.error("NOT_FOUND", {message: "Admin user not found"})
        }

        const adminPlugin = getAdminPlugin(ctx.context)
        const admin = adminUser.user as UserWithRole
        const roleDefinitions = adminPlugin.options?.roles || defaultAdminRoles
        const hasPermission = (permission: "impersonate" | "impersonate-admins") =>
          Boolean(adminPlugin.options?.adminUserIds?.includes(admin.id)) ||
          (admin.role || adminPlugin.options?.defaultRole || "user")
            .split(",")
            .some(
              (role: string) =>
                roleDefinitions[role.trim()]?.authorize({user: [permission]}).success
            )

        if (!hasPermission("impersonate")) {
          return ctx.error("FORBIDDEN", {message: "User cannot impersonate other users"})
        }

        const targetUser = (await ctx.context.internalAdapter.findUserById(
          ctx.body.targetUserId
        )) as UserWithRole | null
        if (!targetUser) {
          return ctx.error("NOT_FOUND", {message: "Target user not found"})
        }

        const adminRoles = (
          Array.isArray(adminPlugin.options?.adminRoles)
            ? adminPlugin.options.adminRoles
            : adminPlugin.options?.adminRoles?.split(",") || ["admin"]
        ).map((role: string) => role.trim())
        const targetIsAdmin =
          Boolean(adminPlugin.options?.adminUserIds?.includes(targetUser.id)) ||
          (targetUser.role || adminPlugin.options?.defaultRole || "user")
            .split(",")
            .some((role: string) => adminRoles.includes(role.trim()))
        if (
          targetIsAdmin &&
          adminPlugin.options?.allowImpersonatingAdmins !== true &&
          !hasPermission("impersonate-admins")
        ) {
          return ctx.error("FORBIDDEN", {message: "User cannot impersonate administrators"})
        }

        const impersonationDuration = adminPlugin.options?.impersonationSessionDuration || 60 * 60
        const expiresAt = new Date(Date.now() + impersonationDuration * 1000)

        const session = await ctx.context.internalAdapter.createSession(
          targetUser.id,
          true,
          {
            impersonatedBy: admin.id,
            expiresAt,
          },
          true
        )

        const handoffToken = generateId(32)
        const handoffExpiresAt = new Date(
          Math.min(expiresAt.getTime(), Date.now() + IMPERSONATION_HANDOFF_TTL_SECONDS * 1000)
        )

        try {
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `${IMPERSONATION_HANDOFF_PREFIX}${handoffToken}`,
            value: session.token,
            expiresAt: handoffExpiresAt,
          })
        } catch (handoffError) {
          await ctx.context.internalAdapter.deleteSession(session.token)
          throw handoffError
        }

        return ctx.json({
          success: true,
          // Keep the response field for compatibility. This is a one-time handoff token,
          // not the Better Auth session token.
          sessionToken: handoffToken,
        })
      } catch {
        return ctx.error("INTERNAL_SERVER_ERROR")
      }
    }
  ),

  /**
   * Set impersonation session cookie from token
   */
  setImpersonationSession: createAuthEndpoint(
    "/attio/impersonation-session",
    {
      method: "GET",
      query: z.object({
        token: z.string(),
      }),
    },
    async (ctx) => {
      try {
        // Atomically consume the short-lived handoff token. A second request gets null.
        const handoff = await ctx.context.internalAdapter.consumeVerificationValue(
          `${IMPERSONATION_HANDOFF_PREFIX}${ctx.query.token}`
        )
        if (!handoff) {
          return ctx.redirect("/?error=invalid_or_used_session")
        }

        const sessionData = await ctx.context.internalAdapter.findSession(handoff.value)
        if (!sessionData?.session.impersonatedBy) {
          return ctx.redirect("/?error=invalid_session")
        }

        const session =
          (await ctx.context.internalAdapter.updateSession(sessionData.session.token, {
            userAgent: ctx.headers?.get("user-agent") || "",
            ipAddress: ctx.headers ? getIP(ctx.headers, ctx.context.options) : null,
          })) || sessionData.session

        // Better Auth can restore only the session of the same admin that created
        // the impersonation session. Do not preserve an unrelated browser session.
        const currentSession = await getSessionFromCtx(ctx)
        const adminCookie = ctx.context.createAuthCookie("admin_session")
        if (currentSession && currentSession.user.id === sessionData.session.impersonatedBy) {
          const dontRememberMeCookie = await ctx.getSignedCookie(
            ctx.context.authCookies.dontRememberToken.name,
            ctx.context.secret
          )
          await ctx.setSignedCookie(
            adminCookie.name,
            `${currentSession.session.token}:${dontRememberMeCookie || ""}`,
            ctx.context.secret,
            ctx.context.authCookies.sessionToken.attributes
          )
        } else {
          expireCookie(ctx, adminCookie)
        }

        deleteSessionCookie(ctx)
        await setSessionCookie(ctx, {session, user: sessionData.user}, true)
        return ctx.redirect("/")
      } catch {
        return ctx.redirect("/?error=session_failed")
      }
    }
  ),
})
