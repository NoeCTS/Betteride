/* ------------------------------------------------------------------ */
/*  Session Store — persist flyer deployment sessions in localStorage  */
/* ------------------------------------------------------------------ */

import type { FlyerPlan, FlyerPlannerInput, FlyerTimeContext } from "@/lib/types";

export interface SavedSession {
  id: string;
  savedAt: string; // ISO date
  flyerTimeContext: FlyerTimeContext;
  flyerPlannerInput: FlyerPlannerInput;
  /** Snapshot of plan metrics at save time */
  assignedCount: number;
  holdbackCount: number;
  totalExpectedProspects: number;
  totalExpectedFlyers: number;
  uniqueZoneCount: number;
  uniqueSpotCount: number;
  summary: string;
  /** Economics snapshot */
  laborCostEur: number;
  printCostEur: number;
  totalCostEur: number;
  estimatedLeads: number;
  costPerProspect: number;
  costPerLead: number;
  /** Top zone names for display */
  topZoneNames: string[];
}

export interface CampaignStats {
  sessionCount: number;
  totalProspects: number;
  totalFlyers: number;
  totalCostEur: number;
  totalLeads: number;
  avgCostPerProspect: number;
  avgCostPerLead: number;
  totalRepHours: number;
  zonesReached: number;
}

const STORAGE_KEY = "betteride-flyer-sessions";
const HOURLY_REP_COST_EUR = 14;
const FLYER_UNIT_COST_EUR = 0.04;
const LEAD_CONVERSION_RATE = 0.03;

export function loadSessions(): SavedSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedSession[];
  } catch {
    return [];
  }
}

export function saveSession(
  plan: FlyerPlan,
  input: FlyerPlannerInput,
  ctx: FlyerTimeContext,
): SavedSession {
  const sessions = loadSessions();

  const laborCost = plan.assignedCount * input.sessionHours * HOURLY_REP_COST_EUR;
  const printCost = plan.totalExpectedFlyers * FLYER_UNIT_COST_EUR;
  const totalCost = laborCost + printCost;
  const estimatedLeads = Math.round(plan.totalExpectedProspects * LEAD_CONVERSION_RATE);

  const session: SavedSession = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    savedAt: new Date().toISOString(),
    flyerTimeContext: ctx,
    flyerPlannerInput: input,
    assignedCount: plan.assignedCount,
    holdbackCount: plan.holdbackCount,
    totalExpectedProspects: plan.totalExpectedProspects,
    totalExpectedFlyers: plan.totalExpectedFlyers,
    uniqueZoneCount: plan.uniqueZoneCount,
    uniqueSpotCount: plan.uniqueSpotCount,
    summary: plan.summary,
    laborCostEur: laborCost,
    printCostEur: printCost,
    totalCostEur: totalCost,
    estimatedLeads,
    costPerProspect: plan.totalExpectedProspects > 0 ? totalCost / plan.totalExpectedProspects : 0,
    costPerLead: estimatedLeads > 0 ? totalCost / estimatedLeads : 0,
    topZoneNames: plan.assignments
      .filter((a) => a.status === "assigned" && a.zoneName)
      .map((a) => a.zoneName!)
      .filter((name, i, arr) => arr.indexOf(name) === i)
      .slice(0, 3),
  };

  sessions.unshift(session);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  return session;
}

export function deleteSession(id: string): void {
  const sessions = loadSessions().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function clearAllSessions(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function computeCampaignStats(sessions: SavedSession[]): CampaignStats {
  if (sessions.length === 0) {
    return {
      sessionCount: 0,
      totalProspects: 0,
      totalFlyers: 0,
      totalCostEur: 0,
      totalLeads: 0,
      avgCostPerProspect: 0,
      avgCostPerLead: 0,
      totalRepHours: 0,
      zonesReached: 0,
    };
  }

  const totalProspects = sessions.reduce((sum, s) => sum + s.totalExpectedProspects, 0);
  const totalFlyers = sessions.reduce((sum, s) => sum + s.totalExpectedFlyers, 0);
  const totalCost = sessions.reduce((sum, s) => sum + s.totalCostEur, 0);
  const totalLeads = sessions.reduce((sum, s) => sum + s.estimatedLeads, 0);
  const totalRepHours = sessions.reduce(
    (sum, s) => sum + s.assignedCount * s.flyerPlannerInput.sessionHours,
    0,
  );
  const allZones = new Set(sessions.flatMap((s) => s.topZoneNames));

  return {
    sessionCount: sessions.length,
    totalProspects,
    totalFlyers,
    totalCostEur: totalCost,
    totalLeads,
    avgCostPerProspect: totalProspects > 0 ? totalCost / totalProspects : 0,
    avgCostPerLead: totalLeads > 0 ? totalCost / totalLeads : 0,
    totalRepHours,
    zonesReached: allZones.size,
  };
}
