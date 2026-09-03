import assert from "node:assert/strict"
import test from "node:test"
import {admin, organization} from "better-auth/plugins"
import {attio} from "../dist/index.js"

const cookieAttributes = {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: false,
}

const authCookies = {
  sessionToken: {name: "session", attributes: cookieAttributes},
  sessionData: {name: "session_data", attributes: cookieAttributes},
  dontRememberToken: {name: "dont_remember", attributes: cookieAttributes},
  accountData: {name: "account_data", attributes: cookieAttributes},
}

const endpointContext = (context, input) => ({
  ...input,
  context,
  headers: new Headers({"user-agent": "Test Browser"}),
  responseHeaders: new Headers(),
  getSignedCookie: async () => null,
  setSignedCookie: async () => {},
  setCookie: () => {},
  json: (value) => value,
})

test("impersonation uses an atomic handoff token instead of a session token", async () => {
  let verification
  let consumedIdentifier
  const adminPlugin = admin()
  const context = {
    secret: "auth-secret",
    options: {
      plugins: [adminPlugin],
      session: {cookieCache: {enabled: false}},
    },
    sessionConfig: {expiresIn: 3600},
    oauthConfig: {storeStateStrategy: "database"},
    authCookies,
    createAuthCookie: (name) => ({name, attributes: cookieAttributes}),
    setNewSession: () => {},
    responseHeaders: new Headers(),
    session: {
      session: {token: "admin-session"},
      user: {id: "admin-id"},
    },
    internalAdapter: {
      findUserByEmail: async () => ({user: {id: "admin-id", role: "admin"}}),
      findUserById: async () => ({id: "target-id", role: "user"}),
      createSession: async (_userId, _dontRemember, data) => ({
        id: "session-id",
        token: "real-session-token",
        userId: "target-id",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }),
      createVerificationValue: async (value) => {
        verification = value
        return value
      },
      consumeVerificationValue: async (identifier) => {
        consumedIdentifier = identifier
        return identifier === verification.identifier ? verification : null
      },
      findSession: async (token) =>
        token === "real-session-token"
          ? {
              session: {
                id: "session-id",
                token,
                userId: "target-id",
                impersonatedBy: "admin-id",
                createdAt: new Date(),
                updatedAt: new Date(),
                expiresAt: new Date(Date.now() + 3_600_000),
              },
              user: {
                id: "target-id",
                name: "Target",
                email: "target@example.com",
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }
          : null,
      updateSession: async (_token, data) => ({
        id: "session-id",
        token: "real-session-token",
        userId: "target-id",
        impersonatedBy: "admin-id",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
        ...data,
      }),
      deleteSession: async () => {},
    },
  }
  const endpoints = attio({secret: "shared-secret"}).endpoints

  const created = await endpoints.impersonateUser(
    endpointContext(context, {
      body: {
        secret: "shared-secret",
        targetUserId: "target-id",
        adminEmail: "admin@example.com",
      },
    })
  )

  assert.notEqual(created.sessionToken, "real-session-token")
  assert.equal(verification.value, "real-session-token")
  assert.equal(verification.identifier, `attio-impersonation:${created.sessionToken}`)
  assert.ok(verification.expiresAt.getTime() <= Date.now() + 5 * 60 * 1000)

  const opened = await endpoints.setImpersonationSession(
    endpointContext(context, {query: {token: created.sessionToken}})
  )

  assert.equal(consumedIdentifier, verification.identifier)
  assert.equal(opened.statusCode, 302)
  assert.equal(opened.headers.get("location"), "/")

  context.internalAdapter.findUserByEmail = async () => ({
    user: {id: "regular-user-id", role: "user"},
  })
  const denied = await endpoints.impersonateUser(
    endpointContext(context, {
      body: {
        secret: "shared-secret",
        targetUserId: "target-id",
        adminEmail: "user@example.com",
      },
    })
  )
  assert.equal(denied.statusCode, 403)
})

test("invitation email receives the stored organization and member", async () => {
  let emailData
  const organizationPlugin = organization({
    sendInvitationEmail: async (data) => {
      emailData = data
    },
  })
  const storedOrganization = {
    id: "organization-id",
    name: "Example",
    slug: "example",
    createdAt: new Date(),
  }
  const storedMember = {
    id: "member-id",
    organizationId: "organization-id",
    userId: "owner-id",
    role: "owner",
    createdAt: new Date(),
  }
  const invitation = {
    id: "invitation-id",
    organizationId: "organization-id",
    inviterId: "owner-id",
    email: "new@example.com",
    role: "member",
    status: "pending",
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
  }
  const context = {
    secret: "auth-secret",
    options: {plugins: [organizationPlugin]},
    runInBackgroundOrAwait: async (promise) => promise,
    internalAdapter: {
      findUserByEmail: async (email) =>
        email === "owner@example.com"
          ? {
              user: {
                id: "owner-id",
                name: "Owner",
                email,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }
          : null,
    },
    adapter: {
      findOne: async ({model}) => {
        if (model === "organization") return storedOrganization
        if (model === "member") return storedMember
        return null
      },
      findMany: async () => [],
      create: async () => invitation,
    },
  }
  const endpoints = attio({secret: "shared-secret"}).endpoints

  const result = await endpoints.createOrganizationInvitation(
    endpointContext(context, {
      body: {
        secret: "shared-secret",
        email: "new@example.com",
        role: "member",
        organizationId: "organization-id",
        inviterEmail: "owner@example.com",
      },
    })
  )

  assert.equal(result.id, "invitation-id")
  assert.equal(emailData.organization, storedOrganization)
  assert.equal(emailData.inviter.id, "member-id")
  assert.equal(emailData.inviter.user.id, "owner-id")
  assert.equal(emailData.invitation, invitation)
})
