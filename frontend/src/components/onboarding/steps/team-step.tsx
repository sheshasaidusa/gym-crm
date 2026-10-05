"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { SimpleSelect } from "@/components/simple-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import type { Speciality, TeamRole } from "../blueprint/types";
import type { Draft, TeamMember } from "../draft";
import { SPECIALITIES, TEAM_ROLES } from "../options";
import { StepHeader } from "../step-header";

const MAX_TEAM = 12;
const roleLabel = (r: TeamRole) => TEAM_ROLES.find((o) => o.value === r)?.label ?? r;
const specLabel = (s: Speciality) => SPECIALITIES.find((o) => o.value === s)?.label ?? s;

type Props = {
  draft: Draft;
  change: (patch: Partial<Draft>, feature: string) => void;
  ownerEmail: string;
  /** Emails that already have an invite or a staff account; those rows can't be removed. */
  invited: Set<string>;
};

export function TeamStep({ draft, change, ownerEmail, invited }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("trainer");
  const [speciality, setSpeciality] = useState<Speciality>("weights");
  const [error, setError] = useState<{ field: "name" | "email"; message: string } | null>(null);

  const add = () => {
    const n = name.trim();
    const e = email.trim().toLowerCase();
    if (!n) return setError({ field: "name", message: "Enter a name" });
    if (!z.email().safeParse(e).success) return setError({ field: "email", message: "Enter a valid email for the invite" });
    if (e === ownerEmail.toLowerCase()) return setError({ field: "email", message: "That's your own email" });
    if (draft.team.some((m) => m.email === e)) return setError({ field: "email", message: "This person is already on the list" });
    setError(null);
    const member: TeamMember = { name: n.slice(0, 40), email: e, role, speciality: role === "trainer" ? speciality : "general" };
    change({ team: [...draft.team, member] }, role === "trainer" ? "trainers" : "reception");
    setName("");
    setEmail("");
  };

  return (
    <>
      <StepHeader title="Invite your team">
        Each person gets an invite link to log in. Trainers appear in their speciality&apos;s area; front desk and managers at
        reception. You can skip this and do it later.
      </StepHeader>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field data-invalid={error?.field === "name"}>
          <FieldLabel htmlFor="member-name">Name</FieldLabel>
          <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" maxLength={40} />
          {error?.field === "name" && <FieldError>{error.message}</FieldError>}
        </Field>
        <Field data-invalid={error?.field === "email"}>
          <FieldLabel htmlFor="member-email">Email</FieldLabel>
          <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          {error?.field === "email" && <FieldError>{error.message}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor="member-role">Role</FieldLabel>
          <SimpleSelect id="member-role" options={TEAM_ROLES} value={role} onChange={(v) => setRole((v || "trainer") as TeamRole)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="member-spec">Speciality</FieldLabel>
          <SimpleSelect
            id="member-spec"
            options={SPECIALITIES}
            value={role === "trainer" ? speciality : "general"}
            disabled={role !== "trainer"}
            onChange={(v) => setSpeciality((v || "general") as Speciality)}
          />
        </Field>
        <Button type="submit" variant="outline" className="sm:col-span-2" disabled={draft.team.length >= MAX_TEAM}>
          Add to the team
        </Button>
      </form>

      {draft.team.length > 0 ? (
        <ul className="divide-y border-y">
          {draft.team.map((m) => {
            const locked = invited.has(m.email);
            return (
              <li key={m.email} className="flex items-center gap-3 py-2.5">
                <span className="flex size-8 flex-none items-center justify-center rounded-full border text-sm font-semibold">
                  {m.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {m.role === "trainer" ? `Trainer · ${specLabel(m.speciality)}` : roleLabel(m.role)}
                </span>
                {locked ? (
                  <Badge variant="secondary">Invited</Badge>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => change({ team: draft.team.filter((x) => x.email !== m.email) }, "trainers")}
                  >
                    <XIcon />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No one added yet. Each person you add appears in the drawing.</p>
      )}
    </>
  );
}
