"use client";

import { AlarmClockIcon, BanknoteIcon, UserPlusIcon, WalletIcon } from "lucide-react";

import { BoardCard, BoardStat, PersonLine } from "@/components/dashboards/parts";
import { useDeskBoard } from "@/lib/dashboard-queries";
import { METHOD_LABELS } from "@/lib/finance-queries";
import { daysLeftLabel, formatDate, formatMoney } from "@/lib/format";
import { useCurrency, useMe } from "@/lib/queries";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The front desk's day: who to renew, who owes, what came in, who is trialling. */
export function DeskDashboard() {
  const gym = useMe().data?.gym.name ?? "the gym";
  const currency = useCurrency();
  const board = useDeskBoard();
  const b = board.data;
  const money = (n: number) => formatMoney(n, currency);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BoardStat label="Renewals" value={b?.renewals_count} icon={AlarmClockIcon} href="/reminders" hint="Ending within 3 days or just ended" tone={b?.renewals_count ? "bad" : undefined} />
        <BoardStat label="Collected today" value={b && money(b.payments_today)} icon={BanknoteIcon} href="/finance?tab=payments" hint={`${b?.payments_today_count ?? 0} payments`} />
        <BoardStat label="Dues outstanding" value={b && money(b.outstanding)} icon={WalletIcon} href="/finance?tab=dues" hint={`${b?.dues_count ?? 0} members owe money`} tone={b?.dues_count ? "bad" : undefined} />
        <BoardStat label="New today" value={b?.new_members_today} icon={UserPlusIcon} href="/members?sort=newest" hint="Members who joined today" />
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <BoardCard
          title="Renewals to chase"
          description="Ending in the next 3 days, or ended in the last week"
          href="/reminders"
          loading={board.isPending}
          empty={b && !b.renewals.length ? "Nobody to chase right now." : undefined}
        >
          <ul className="divide-y">
            {b?.renewals.map((m) => (
              <PersonLine
                key={m.member_id}
                href={`/members/${m.member_id}`}
                name={m.name}
                detail={`${(m.days ?? 0) < 0 ? "Ended" : "Ends"} ${formatDate(m.on, { year: false })}`}
                right={daysLeftLabel(m.days)}
                phone={m.phone}
                message={`Hi ${m.name.split(" ")[0]}, your membership at ${gym} ${(m.days ?? 0) < 0 ? "ended" : "ends"} on ${formatDate(m.on)}. Would you like to renew?`}
              />
            ))}
          </ul>
        </BoardCard>

        <BoardCard
          title="Biggest dues"
          description="Money still owed on memberships"
          href="/finance?tab=dues"
          loading={board.isPending}
          empty={b && !b.dues.length ? "No dues. Nice." : undefined}
        >
          <ul className="divide-y">
            {b?.dues.map((d) => (
              <PersonLine
                key={`${d.member_id}-${d.plan_name}`}
                href={`/members/${d.member_id}`}
                name={d.name}
                detail={d.plan_name}
                right={<span className="font-medium text-red-600 tabular-nums dark:text-red-400">{money(d.balance)}</span>}
                phone={d.phone}
                message={`Hi ${d.name.split(" ")[0]}, a gentle reminder from ${gym}: ${money(d.balance)} is pending on your ${d.plan_name} membership.`}
              />
            ))}
          </ul>
        </BoardCard>

        <BoardCard
          title="Today's takings"
          description="Payments received today by method"
          href="/finance?tab=payments"
          loading={board.isPending}
          empty={b && !b.payments_by_method.length ? "No payments yet today." : undefined}
        >
          <ul className="divide-y text-sm">
            {b?.payments_by_method.map((m) => (
              <li key={m.method} className="flex items-center justify-between py-2.5">
                <span>
                  {METHOD_LABELS[m.method as keyof typeof METHOD_LABELS] ?? m.method}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {m.payments} payment{m.payments === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="tabular-nums">{money(m.amount)}</span>
              </li>
            ))}
          </ul>
        </BoardCard>

        <BoardCard
          title="Trials today"
          description="Leads booked in for a trial session"
          href="/leads/trials"
          loading={board.isPending}
          empty={b && !b.trials_today.length ? "No trials booked for today." : undefined}
        >
          <ul className="divide-y">
            {b?.trials_today.map((t) => (
              <PersonLine
                key={t.lead_id}
                href="/leads"
                name={t.name}
                detail={t.assigned_to ? `With ${t.assigned_to}` : "Not assigned"}
                right={time(t.trial_at)}
                phone={t.phone}
                message={`Hi ${t.name.split(" ")[0]}, we are looking forward to seeing you at ${gym} today at ${time(t.trial_at)} for your trial!`}
              />
            ))}
          </ul>
        </BoardCard>
      </div>
    </>
  );
}
