import type { Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";

/** One plain sentence about where a member's membership stands, for the member-facing pages. */
export function membershipLine(m: Schemas["PublicMembership"]) {
  switch (m.status) {
    case "expired":
      return `Ended on ${formatDate(m.end_date)}. Talk to us to renew.`;
    case "upcoming":
      return `Starts on ${formatDate(m.start_date)}.`;
    case "frozen":
      return `Paused until ${formatDate(m.frozen_until)}. Ends ${formatDate(m.end_date)}.`;
    default:
      return m.days_left === 0
        ? "Ends today."
        : `${m.days_left} day${m.days_left === 1 ? "" : "s"} left · ends ${formatDate(m.end_date)}`;
  }
}
