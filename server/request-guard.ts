/**
 * Trust boundary for API requests. The backend listens on loopback only, but any website
 * open in the user's browser can otherwise send state-changing "simple" requests (for
 * example a `text/plain` body, which needs no CORS preflight), including terminal input.
 *
 * Rules (see plans/proposals/browser-websocket-transport.md, Security):
 * - `Host` must exactly match an allowed application host on every API request
 *   (DNS-rebinding defense).
 * - State-changing methods must carry an `Origin` that exactly matches an allowed
 *   application origin. A missing `Origin` is accepted only when `Sec-Fetch-Site` is also
 *   missing: browsers always send one or the other, so "neither present" means a local
 *   non-browser client (the documented curl workflow); no page script can strip
 *   `Sec-Fetch-Site`, a forbidden header.
 * - JSON bodies must be `application/json` (parameters such as `charset` allowed), which
 *   makes cross-site requests non-simple and therefore preflighted.
 *
 * Origin is not authentication; for a loopback-only tool this is the proportionate posture.
 */

export interface RequestGuardInput {
  method: string
  host: string | undefined
  origin: string | undefined
  secFetchSite: string | undefined
}

export interface RequestGuardRejection {
  status: 403 | 415
  error: string
  allowedOrigins: string[]
}

export interface RequestGuard {
  readonly allowedOrigins: string[]
  readonly allowedHosts: string[]
  /** Returns why a request must be refused, or null when it may proceed. */
  violation(input: RequestGuardInput): RequestGuardRejection | null
  /** Stricter rule for WebSocket upgrades: a browser Origin is always required. */
  upgradeViolation(
    input: { host: string | undefined; origin: string | undefined },
  ): RequestGuardRejection | null
}

export interface RequestGuardOptions {
  backendPort: number
  frontendPort: number
}

/** Builds the guard from the backend and development frontend ports. */
export function createRequestGuard(
  { backendPort, frontendPort }: RequestGuardOptions,
): RequestGuard {
  const allowedOrigins = [
    `http://127.0.0.1:${backendPort}`,
    `http://localhost:${backendPort}`,
    `http://127.0.0.1:${frontendPort}`,
    `http://localhost:${frontendPort}`,
  ]
  const allowedHosts = [
    `127.0.0.1:${backendPort}`,
    `localhost:${backendPort}`,
    `127.0.0.1:${frontendPort}`,
    `localhost:${frontendPort}`,
  ]
  return {
    allowedOrigins,
    allowedHosts,
    violation({ method, host, origin, secFetchSite }) {
      if (host === undefined || !allowedHosts.includes(host.toLowerCase())) {
        return {
          status: 403,
          error: `Requests must target an application host (allowed: ${allowedHosts.join(', ')}).`,
          allowedOrigins,
        }
      }
      const stateChanging = method !== 'GET' && method !== 'HEAD'
      if (!stateChanging) return null
      if (origin !== undefined) {
        if (allowedOrigins.includes(origin)) return null
        return {
          status: 403,
          error: `Requests from this origin are not allowed (allowed: ${
            allowedOrigins.join(', ')
          }).`,
          allowedOrigins,
        }
      }
      if (secFetchSite !== undefined) {
        return {
          status: 403,
          error: 'Browser requests must carry an Origin header.',
          allowedOrigins,
        }
      }
      return null
    },

    /**
     * WebSocket upgrades must always carry a browser `Origin` (they are not subject to
     * CORS, so any page could otherwise connect), and it must exactly match.
     */
    upgradeViolation(
      { host, origin }: { host: string | undefined; origin: string | undefined },
    ): RequestGuardRejection | null {
      if (host !== undefined && !allowedHosts.includes(host.toLowerCase())) {
        return {
          status: 403,
          error: `Requests must target an application host (allowed: ${allowedHosts.join(', ')}).`,
          allowedOrigins,
        }
      }
      if (origin === undefined || !allowedOrigins.includes(origin)) {
        return {
          status: 403,
          error: `WebSocket connections must carry an allowed Origin (allowed: ${
            allowedOrigins.join(', ')
          }).`,
          allowedOrigins,
        }
      }
      return null
    },
  }
}

/** Whether a Content-Type header names JSON, ignoring parameters such as charset. */
export function isJsonContentType(header: string | undefined): boolean {
  const mediaType = (header ?? '').split(';')[0]?.trim().toLowerCase()
  return mediaType === 'application/json'
}
