import type { BrowserOptions, ErrorEvent } from "@sentry/nextjs";

/** Collect as little as possible: no user info, cookies, bodies or query strings. */
export const DATA_COLLECTION: BrowserOptions["dataCollection"] = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent", "content-type"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
};

// Preview links (/p/…) and invites carry secret tokens in the URL.
const TOKEN = /(\/(?:p|invite|invites)\/)[A-Za-z0-9_-]{20,}/g;

export function redactUrl(url: string) {
  return url.replace(TOKEN, "$1:token").split("?")[0];
}

/** No personal data leaves the app: no bodies, cookies, query strings or tokens. */
export function scrub(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = redactUrl(event.request.url);
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (/^(authorization|cookie|set-cookie)$/i.test(name)) event.request.headers[name] = "[removed]";
      }
    }
  }
  delete event.user;
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.data?.url === "string") crumb.data.url = redactUrl(crumb.data.url);
    if (typeof crumb.data?.to === "string") crumb.data.to = redactUrl(crumb.data.to);
    if (typeof crumb.data?.from === "string") crumb.data.from = redactUrl(crumb.data.from);
  }
  return event;
}
