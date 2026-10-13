"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useState } from "react";

import { FollowUpBadge } from "@/components/leads/follow-up";
import { needsDialog, StageDialog, type PendingMove } from "@/components/leads/stage-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import {
  OPEN_STAGES,
  SOURCE_LABELS,
  STAGE_LABELS,
  useMoveLead,
  type Lead,
  type LeadStage,
} from "@/lib/lead-queries";
import { cn } from "@/lib/utils";

const COLUMNS: LeadStage[] = [...OPEN_STAGES, "lost"];

function LeadCard({ lead, onOpen, overlay }: { lead: Lead; onOpen?: () => void; overlay?: boolean }) {
  return (
    <div
      className={cn(
        "grid gap-2 rounded-2xl border bg-background p-4 text-left text-sm transition-[transform,opacity,box-shadow,border-color] duration-200",
        overlay && "scale-[0.98] rotate-1 border-primary/25 shadow-xl",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left text-sm leading-6 font-medium text-card-foreground hover:underline">
          {lead.name}
        </button>
        {lead.assigned_to && (
          <Avatar className="size-6 border bg-background" title={`Assigned to ${lead.assigned_to.name}`}>
            <AvatarFallback className="text-[10px]">{initials(lead.assigned_to.name)}</AvatarFallback>
          </Avatar>
        )}
      </div>
      {lead.interest && <p className="line-clamp-2 text-xs text-muted-foreground">{lead.interest}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {SOURCE_LABELS[lead.source]}
        </span>
        {lead.stage !== "lost" && <FollowUpBadge iso={lead.next_follow_up_at} />}
        {lead.stage === "lost" && lead.lost_reason && (
          <span className="truncate text-xs text-muted-foreground">{lead.lost_reason}</span>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, data: lead });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-roledescription="Draggable lead"
      className={cn("cursor-grab touch-manipulation active:cursor-grabbing", isDragging && "opacity-30")}
    >
      <LeadCard lead={lead} onOpen={onOpen} />
    </div>
  );
}

function Column({
  stage,
  leads,
  onOpen,
}: {
  stage: LeadStage;
  leads: Lead[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      aria-label={STAGE_LABELS[stage]}
      className={cn(
        "flex w-64 shrink-0 snap-start flex-col gap-2 rounded-2xl border border-transparent bg-card p-2 shadow-raised-control transition-[background-color,border-color,box-shadow] sm:w-72",
        isOver && "border-dashed border-primary/60 bg-primary/5 shadow-none",
        stage === "lost" && "opacity-80",
      )}
    >
      <header className="flex h-9 items-center justify-between px-2">
        <h3 className="text-xs font-medium text-foreground">{STAGE_LABELS[stage]}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{leads.length}</span>
      </header>
      <div className="grid min-h-24 content-start gap-2">
        {leads.map((lead) => (
          <DraggableCard key={lead.id} lead={lead} onOpen={() => onOpen(lead.id)} />
        ))}
        {leads.length === 0 && (
          <p className="flex h-24 items-center justify-center rounded-2xl border border-dashed border-primary/45 bg-primary/5 text-[11px] font-medium text-primary">
            Drop leads here
          </p>
        )}
      </div>
    </section>
  );
}

export function LeadBoard({ leads, onOpen }: { leads: Lead[]; onOpen: (id: string) => void }) {
  const move = useMoveLead();
  const [active, setActive] = useState<Lead | null>(null);
  const [pending, setPending] = useState<PendingMove>(null);
  const sensors = useSensors(
    // A small distance so clicking a card's name still opens it.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    const lead = a.data.current as Lead | undefined;
    const stage = over?.id as LeadStage | undefined;
    if (!lead || !stage || stage === lead.stage) return;
    if (needsDialog(stage)) setPending({ lead, stage });
    else move.mutate({ id: lead.id, stage });
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setActive(e.active.data.current as Lead)}
        onDragCancel={() => setActive(null)}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active: a }) => `Picked up ${(a.data.current as Lead).name}`,
            onDragOver: ({ over }) => (over ? `Over ${STAGE_LABELS[over.id as LeadStage]}` : "Not over a column"),
            onDragEnd: ({ active: a, over }) =>
              over ? `Moved ${(a.data.current as Lead).name} to ${STAGE_LABELS[over.id as LeadStage]}` : "Cancelled",
            onDragCancel: () => "Cancelled",
          },
        }}
      >
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 md:-mx-6 md:px-6">
          {COLUMNS.map((stage) => (
            <Column key={stage} stage={stage} leads={leads.filter((l) => l.stage === stage)} onOpen={onOpen} />
          ))}
        </div>
        <DragOverlay>{active && <LeadCard lead={active} overlay />}</DragOverlay>
      </DndContext>
      <StageDialog move={pending} onDone={() => setPending(null)} />
    </>
  );
}
