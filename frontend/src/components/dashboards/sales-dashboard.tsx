"use client";

import { CalendarClockIcon, MagnetIcon, PhoneCallIcon, TrophyIcon } from "lucide-react";

import { Bars, BoardCard, BoardStat, PersonLine } from "@/components/dashboards/parts";
import { useSalesBoard } from "@/lib/dashboard-queries";
import { SOURCE_LABELS, STAGE_LABELS } from "@/lib/lead-queries";
import { useMe } from "@/lib/queries";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

/** A salesperson's pipeline against the team's, what to follow up on, and trials coming up. */
export function SalesDashboard() {
  const gym = useMe().data?.gym.name ?? "the gym";
  const board = useSalesBoard();
  const b = board.data;
  const open = (rows: { leads: number }[] | undefined) => rows?.reduce((s, r) => s + r.leads, 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BoardStat label="Follow-ups due" value={b?.follow_ups_due} icon={PhoneCallIcon} href="/leads" hint="Today or overdue" tone={b?.follow_ups_due ? "bad" : undefined} />
        <BoardStat label="My open leads" value={open(b?.pipeline_mine)} icon={MagnetIcon} href="/leads" hint={`${open(b?.pipeline_team) ?? 0} across the team`} />
        <BoardStat label="Joined (30 days)" value={b?.converted_mine_30d} icon={TrophyIcon} hint={`${b?.converted_team_30d ?? 0} across the team`} />
        <BoardStat label="Conversion (90 days)" value={b && pct(b.conversion_mine_90d)} icon={CalendarClockIcon} hint={`Team: ${pct(b?.conversion_team_90d)}`} />
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <BoardCard
          title="Follow up now"
          description="Your leads due a call, oldest first"
          href="/leads"
          loading={board.isPending}
          empty={b && !b.follow_ups.length ? "No follow-ups due." : undefined}
        >
          <ul className="divide-y">
            {b?.follow_ups.map((l) => (
              <PersonLine
                key={l.lead_id}
                href="/leads"
                name={l.name}
                detail={`${STAGE_LABELS[l.stage]} · ${SOURCE_LABELS[l.source]}`}
                right={when(l.at)}
                phone={l.phone}
                message={`Hi ${l.name.split(" ")[0]}, this is ${gym}. Following up on your enquiry. Is now a good time to talk?`}
              />
            ))}
          </ul>
        </BoardCard>

        <BoardCard
          title="Upcoming trials"
          description="Your trials in the next 7 days"
          href="/leads/trials"
          loading={board.isPending}
          empty={b && !b.trials.length ? "No trials booked." : undefined}
        >
          <ul className="divide-y">
            {b?.trials.map((l) => (
              <PersonLine
                key={l.lead_id}
                href="/leads"
                name={l.name}
                detail={STAGE_LABELS[l.stage]}
                right={when(l.at)}
                phone={l.phone}
                message={`Hi ${l.name.split(" ")[0]}, a reminder about your trial at ${gym} on ${when(l.at)}. See you there!`}
              />
            ))}
          </ul>
        </BoardCard>

        <BoardCard title="My pipeline" description="Open leads by stage" loading={board.isPending}>
          {b && <Bars rows={b.pipeline_mine.map((s) => ({ label: STAGE_LABELS[s.stage], value: s.leads }))} />}
        </BoardCard>

        <BoardCard
          title="Team pipeline"
          description="Everyone's open leads, and why leads were lost in the last 90 days"
          loading={board.isPending}
        >
          {b && (
            <div className="grid gap-5">
              <Bars rows={b.pipeline_team.map((s) => ({ label: STAGE_LABELS[s.stage], value: s.leads }))} />
              {b.lost_reasons.length > 0 && (
                <div className="grid gap-2 border-t pt-4">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase">Lost because</h4>
                  <Bars rows={b.lost_reasons.map((r) => ({ label: r.reason, value: r.leads }))} />
                </div>
              )}
            </div>
          )}
        </BoardCard>
      </div>
    </>
  );
}
