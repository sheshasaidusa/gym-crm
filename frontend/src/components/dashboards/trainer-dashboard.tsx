"use client";

import { AlarmClockIcon, ClipboardListIcon, HeartPulseIcon, UsersIcon } from "lucide-react";

import { BoardCard, BoardStat, PersonLine } from "@/components/dashboards/parts";
import { daysLeftLabel, formatDate } from "@/lib/format";
import { useTrainerBoard } from "@/lib/dashboard-queries";
import { useMe } from "@/lib/queries";

/** One trainer's clients and what needs doing. `trainerId` lets owners and managers look at anyone's. */
export function TrainerDashboard({ trainerId }: { trainerId?: string }) {
  const me = useMe().data;
  const board = useTrainerBoard(trainerId);
  const b = board.data;
  const gym = me?.gym.name ?? "the gym";
  const members = (query: string) => `/members?${trainerId ? `trainer=${trainerId}&` : ""}${query}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BoardStat label="Clients" value={b?.clients.all} icon={UsersIcon} href={members("")} hint={`${b?.clients.active ?? 0} with a running membership`} />
        <BoardStat label="Expiring soon" value={b?.clients.expiring} icon={AlarmClockIcon} href={members("status=expiring&sort=ending")} hint="Ending in 7 days" />
        <BoardStat label="Check-ups due" value={b?.checkups_due} icon={HeartPulseIcon} href="/checkups" hint="Past the check-up interval" tone={b?.checkups_due ? "bad" : undefined} />
        <BoardStat label="No workout plan" value={b?.without_plan} icon={ClipboardListIcon} href={members("status=active")} hint="Running members without a plan" />
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <BoardCard
          title="Check-ups due"
          description="Longest-waiting first"
          href="/checkups"
          loading={board.isPending}
          empty={b && !b.checkups_due_list.length ? "Everyone is up to date." : undefined}
        >
          <ul className="divide-y">
            {b?.checkups_due_list.map((m) => (
              <PersonLine
                key={m.member_id}
                href={`/members/${m.member_id}`}
                name={m.name}
                detail={m.on ? `Last check-up ${formatDate(m.on, { year: false })}` : "Never checked up"}
                right={m.days != null ? `${m.days}d ago` : "New"}
                phone={m.phone}
                message={`Hi ${m.name.split(" ")[0]}, it is time for your check-up at ${gym}. When are you free to come in?`}
              />
            ))}
          </ul>
        </BoardCard>

        <BoardCard
          title="Renewals coming up"
          description="Clients whose membership ends within 7 days"
          href={members("status=expiring&sort=ending")}
          loading={board.isPending}
          empty={b && !b.expiring.length ? "No memberships ending this week." : undefined}
        >
          <ul className="divide-y">
            {b?.expiring.map((m) => (
              <PersonLine
                key={m.member_id}
                href={`/members/${m.member_id}`}
                name={m.name}
                detail={`Ends ${formatDate(m.on, { year: false })}`}
                right={daysLeftLabel(m.days)}
                phone={m.phone}
                message={`Hi ${m.name.split(" ")[0]}, your membership at ${gym} ends on ${formatDate(m.on)}. Shall we get you renewed so you keep your momentum?`}
              />
            ))}
          </ul>
        </BoardCard>

        <BoardCard
          title="Needs a workout plan"
          description="Running members without a published plan"
          loading={board.isPending}
          empty={b && !b.without_plan_list.length ? "Every running client has a plan." : undefined}
        >
          <ul className="divide-y">
            {b?.without_plan_list.map((m) => (
              <PersonLine key={m.member_id} href={`/members/${m.member_id}`} name={m.name} detail={m.phone} />
            ))}
          </ul>
        </BoardCard>

        <BoardCard title="Progress" description="Clients with two or more check-ups in the last 90 days" loading={board.isPending}>
          {b && (
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Tracked</dt>
                <dd className="text-2xl font-medium tabular-nums">{b.progress.members_tracked}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">On track</dt>
                <dd className="text-2xl font-medium tabular-nums">
                  {b.progress.members_tracked ? `${Math.round((b.progress.on_track * 100) / b.progress.members_tracked)}%` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Avg weight</dt>
                <dd className="text-2xl font-medium tabular-nums">
                  {b.progress.avg_weight_change == null ? "—" : `${b.progress.avg_weight_change > 0 ? "+" : ""}${b.progress.avg_weight_change} kg`}
                </dd>
              </div>
            </dl>
          )}
        </BoardCard>
      </div>
    </>
  );
}
