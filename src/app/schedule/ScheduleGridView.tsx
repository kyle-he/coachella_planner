"use client";

import { useCallback } from "react";
import { STAGES, type Stage } from "@/lib/coachella-data";

/** Minutes from midnight; supports festival “25:00” style times */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatTimeShort(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const hour = h > 24 ? h - 24 : h;
  const ampm = hour >= 12 && hour < 24 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** Compact clock for the left time rail only, e.g. 7PM (no space; on-the-hour omits :00). */
function formatTimeRailCompact(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const hour = h > 24 ? h - 24 : h;
  const ampm = hour >= 12 && hour < 24 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  if (m === 0) return `${display}${ampm}`;
  return `${display}:${m.toString().padStart(2, "0")}${ampm}`;
}

export interface ScheduleGridArtist {
  setTime: {
    stage: string;
    startTime: string;
    endTime: string;
    day: string;
    artist: { name: string };
  };
}

export interface PartyMemberBrief {
  name: string;
  image: string;
}

export interface ScheduleGridItem {
  recommendation: ScheduleGridArtist;
  /** Same key as list rows (e.g. slot id for optimized plan) */
  rowKey: string;
  /** Set when grid shows full day + optimized plan: this set is in your plan */
  inPlan?: boolean;
  /** Party members (other than self) who have this set in their plan */
  partyMembers?: PartyMemberBrief[];
}

interface ScheduleGridViewProps {
  items: ScheduleGridItem[];
  stageColors: Record<string, string>;
  expandedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Fill parent flex area and own all scrolling (full-viewport grid mode) */
  fillViewport?: boolean;
  /** Enable +/x edit buttons on each cell */
  editable?: boolean;
  /** Called when a cell's plan membership should toggle */
  onTogglePlan?: (rowKey: string, currentlyInPlan: boolean) => void;
}

/** Narrow rail: compact “7PM” labels read larger than old “7:00 PM” strings */
const TIME_GUTTER_PX = 52;
/** Vertical scale: minutes → pixels (readable on phone, scrolls for long days; 1.5× for room for avatars) */
const MINUTES_PER_PX = 1.52 * 1.5;
const GRID_MIN_WIDTH_PX = 920;
/** Min width per stage column (×7 stages + gutter sets scroll width) */
const STAGE_COL_MIN_PX = 124;

export function ScheduleGridView({
  items,
  stageColors,
  expandedKey,
  onSelect,
  fillViewport = false,
  editable = false,
  onTogglePlan,
}: ScheduleGridViewProps) {
  const handleCellClick = useCallback(
    (rowKey: string) => {
      onSelect(expandedKey === rowKey ? null : rowKey);
    },
    [onSelect, expandedKey]
  );

  const { dayStartMin, dayEndMin, heightPx, byStage } = (() => {
    if (items.length === 0) {
      return {
        dayStartMin: 13 * 60,
        dayEndMin: 26 * 60,
        heightPx: 600,
        byStage: new Map<Stage, ScheduleGridItem[]>(),
      };
    }

    let minM = Infinity;
    let maxM = -Infinity;
    for (const { recommendation: r } of items) {
      const s = timeToMinutes(r.setTime.startTime);
      const e = timeToMinutes(r.setTime.endTime);
      minM = Math.min(minM, s);
      maxM = Math.max(maxM, e);
    }

    const padM = 20;
    const dayStartMin = minM - padM;
    const dayEndMin = maxM + padM;
    const totalM = Math.max(dayEndMin - dayStartMin, 60);
    const rawHeight = Math.max(totalM * MINUTES_PER_PX, 480);
    const heightPx = fillViewport ? rawHeight : Math.min(rawHeight, 8400);

    const byStage = new Map<Stage, ScheduleGridItem[]>();
    for (const s of STAGES) byStage.set(s, []);
    for (const item of items) {
      const st = item.recommendation.setTime.stage as Stage;
      if (byStage.has(st)) byStage.get(st)!.push(item);
    }

    return { dayStartMin, dayEndMin, heightPx, byStage };
  })();

  const scrollClass = fillViewport
    ? "min-h-0 flex-1 overflow-auto overscroll-contain [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]"
    : "overflow-auto overscroll-contain max-h-[min(72vh,calc(100dvh-10rem))] [-webkit-overflow-scrolling:touch]";

  const totalM = dayEndMin - dayStartMin;

  const hourTicks: number[] = [];
  const startHour = Math.floor(dayStartMin / 60);
  const endHour = Math.ceil(dayEndMin / 60);
  for (let h = startHour; h <= endHour; h++) {
    const tickMin = h * 60;
    if (tickMin >= dayStartMin - 1 && tickMin <= dayEndMin + 1) {
      hourTicks.push(tickMin);
    }
  }

  /** :30 marks only (hour lines are drawn separately) */
  const halfHourTicks: number[] = [];
  let hm = Math.ceil(dayStartMin / 30) * 30;
  while (hm <= dayEndMin) {
    if (hm % 60 !== 0) {
      halfHourTicks.push(hm);
    }
    hm += 30;
  }

  function pctFromMin(m: number) {
    return ((m - dayStartMin) / totalM) * 100;
  }

  function formatHourRailLabel(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const s = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    return formatTimeRailCompact(s);
  }

  return (
    <div
      className={
        fillViewport
          ? "flex min-h-0 min-w-0 flex-1 flex-col"
          : "border-b border-border/40"
      }
    >
      <div
        className={scrollClass}
        role="region"
        aria-label="Schedule grid: stages across the top, time down the side"
      >
        <div
          className="block w-max min-w-full"
          style={{
            minWidth: Math.max(
              GRID_MIN_WIDTH_PX,
              TIME_GUTTER_PX + STAGES.length * STAGE_COL_MIN_PX
            ),
          }}
        >
          {/* One sticky wrapper for the whole header row — sticky on each flex-1 cell breaks under 2D scroll in some browsers */}
          <div className="sticky top-0 z-50 w-full shrink-0 bg-background">
            <div className="flex w-full border-b border-border/50">
              <div
                className="sticky left-0 z-[60] shrink-0 border-r border-border/50 bg-background px-1 py-2"
                style={{ width: TIME_GUTTER_PX, minWidth: TIME_GUTTER_PX }}
              />
              {STAGES.map((stage, i) => (
                <div
                  key={stage}
                  className={
                    i > 0
                      ? "min-w-[124px] flex-1 border-l border-border/50 bg-background px-1.5 py-2.5 text-center"
                      : "min-w-[124px] flex-1 bg-background px-1.5 py-2.5 text-center"
                  }
                >
                  <span className="inline-block text-xs font-medium leading-tight text-muted sm:text-sm">
                    {stage}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Body: time rail + stage columns */}
          <div className="flex w-full">
            <div
              className="sticky left-0 z-[35] shrink-0 border-r border-border/50 bg-background"
              style={{
                width: TIME_GUTTER_PX,
                minWidth: TIME_GUTTER_PX,
                height: heightPx,
              }}
            >
              {hourTicks.map((tickMin) => {
                const pct = pctFromMin(tickMin);
                return (
                  <div
                    key={tickMin}
                    className="absolute left-0 right-0 flex justify-end pr-1"
                    style={{
                      top: `${pct}%`,
                      transform: "translateY(-50%)",
                    }}
                  >
                    <span className="text-xs font-medium tabular-nums leading-none text-muted/90 sm:text-sm">
                      {formatHourRailLabel(tickMin)}
                    </span>
                  </div>
                );
              })}
            </div>

            {STAGES.map((stage, i) => (
              <div
                key={stage}
                className={
                  i > 0
                    ? "relative min-w-[124px] flex-1 border-l border-border/50"
                    : "relative min-w-[124px] flex-1"
                }
                style={{ height: heightPx }}
              >
                {/* Full-hour guides */}
                {hourTicks.map((tickMin) => (
                  <div
                    key={`${stage}-h-${tickMin}`}
                    className="pointer-events-none absolute left-0 right-0 border-t border-border/25"
                    style={{ top: `${pctFromMin(tickMin)}%` }}
                  />
                ))}
                {/* Half-hour (:30) guides */}
                {halfHourTicks.map((tickMin) => (
                  <div
                    key={`${stage}-m30-${tickMin}`}
                    className="pointer-events-none absolute left-0 right-0 border-t border-border/12"
                    style={{ top: `${pctFromMin(tickMin)}%` }}
                  />
                ))}

                {(byStage.get(stage) ?? []).map((item) => {
                  const rec = item.recommendation;
                  const startM = timeToMinutes(rec.setTime.startTime);
                  const endM = timeToMinutes(rec.setTime.endTime);
                  const top = pctFromMin(startM);
                  const h = Math.max(pctFromMin(endM) - top, 2.5);
                  const rowKey = item.rowKey;
                  const stageColor = stageColors[rec.setTime.stage] || "#888888";
                  const isOn = expandedKey === rowKey;
                  const inPlan = item.inPlan === true;

                  return (
                    <button
                      key={rowKey}
                      type="button"
                      onClick={() => handleCellClick(rowKey)}
                      className={`absolute inset-x-0.5 flex flex-col overflow-hidden rounded text-left transition-[border-color,background-color,filter,box-shadow] duration-200 ease-out ${
                        inPlan
                          ? isOn
                            ? "z-20 border border-[color-mix(in_srgb,var(--cream)_40%,transparent)] shadow-[inset_0_0_0_2px_var(--cream)]"
                            : "z-10 border border-[color-mix(in_srgb,var(--cream)_22%,transparent)] hover:border-[color-mix(in_srgb,var(--cream)_32%,transparent)] hover:brightness-[1.08]"
                          : isOn
                            ? "z-20 border border-cyan/50 bg-[var(--expand-wash)] ring-1 ring-cyan/30"
                            : "z-10 border border-dashed border-border/50 bg-[var(--hover-wash)] shadow-[0_1px_2px_rgba(12,31,36,0.14)] hover:bg-[var(--hover-wash-strong)] hover:shadow-[0_1px_2px_rgba(12,31,36,0.18)]"
                      }`}
                      style={{
                        top: `${top}%`,
                        height: `${h}%`,
                        minHeight: 60,
                        ...(inPlan ? { backgroundColor: stageColor } : {}),
                      }}
                      aria-expanded={isOn}
                      aria-label={`${rec.setTime.artist.name} at ${formatTimeShort(rec.setTime.startTime)} on ${stage}${inPlan ? " — in your plan" : ""}`}
                    >
                      {editable && onTogglePlan && (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={inPlan ? "Remove from plan" : "Add to plan"}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTogglePlan(rowKey, inPlan);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              e.preventDefault();
                              onTogglePlan(rowKey, inPlan);
                            }
                          }}
                          className={`absolute bottom-1 right-1 z-30 flex h-5 w-5 items-center justify-center text-[14px] font-bold leading-none transition-opacity ${
                            inPlan
                              ? "text-[var(--cream)] opacity-60 hover:opacity-100"
                              : "text-muted opacity-50 hover:opacity-100 hover:text-foreground"
                          }`}
                        >
                          {inPlan ? "×" : "+"}
                        </span>
                      )}
                      {!inPlan && (
                        <span
                          className="h-0.5 w-full shrink-0"
                          style={{ backgroundColor: stageColor }}
                          aria-hidden
                        />
                      )}
                      <div className="flex min-h-0 flex-1 flex-col items-start gap-0.5 px-2 pt-1.5 pb-0">
                        <span
                          className={`line-clamp-3 min-w-0 text-[12px] leading-snug sm:text-xs ${
                            inPlan
                              ? "font-semibold text-[var(--cream)]"
                              : "font-semibold text-muted"
                          }`}
                        >
                          {rec.setTime.artist.name}
                        </span>
                      </div>
                      <div className="mt-auto flex flex-col gap-1.5 px-2 pb-1.5">
                        {item.partyMembers && item.partyMembers.length > 0 && (
                          <PartyMemberAvatarStack
                            members={item.partyMembers}
                            inPlan={inPlan}
                          />
                        )}
                        <span
                          className={`text-[10px] tabular-nums sm:text-[11px] ${
                            inPlan
                              ? "text-[color-mix(in_srgb,var(--cream)_78%,transparent)]"
                              : "text-muted/80"
                          }`}
                        >
                          {formatTimeShort(rec.setTime.startTime)} –{" "}
                          {formatTimeShort(rec.setTime.endTime)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Visible faces before +X (matches list view). */
export const PARTY_MEMBER_STACK_MAX = 5;

/** Stacked party PFPs for grid cells and list rows. */
export function PartyMemberAvatarStack({
  members,
  inPlan,
}: {
  members: PartyMemberBrief[];
  inPlan: boolean;
}) {
  const shown = members.slice(0, PARTY_MEMBER_STACK_MAX);
  const overflow = members.length - PARTY_MEMBER_STACK_MAX;

  return (
    <div className="flex items-center -space-x-1.5" onClick={(e) => e.stopPropagation()}>
      {shown.map((m, i) => (
        <img
          key={i}
          src={m.image}
          alt={m.name}
          title={m.name}
          className="h-4 w-4 rounded-full object-cover"
          style={{ zIndex: i }}
          referrerPolicy="no-referrer"
        />
      ))}
      {overflow > 0 && (
        <span
          className={`flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none ${
            inPlan
              ? "bg-[color-mix(in_srgb,var(--cream)_25%,transparent)] text-[var(--cream)]"
              : "bg-[var(--hover-wash-strong)] text-muted"
          }`}
          style={{ zIndex: 0 }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
