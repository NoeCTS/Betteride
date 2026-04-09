import { distanceKm, round } from "@/lib/geo";
import { formatFlyerTimeLabel } from "@/lib/time-model";
import type {
  FlyerPlan,
  FlyerPlanAssignment,
  FlyerPlannerInput,
  FlyerSpot,
  FlyerTimeContext,
  FlyerZoneScore,
} from "@/lib/types";

const SECOND_PERSON_STACK_FACTOR = 0.55;
const ZONE_REPEAT_DECAY = 0.86;
const TAKE_RATE = 0.35;

interface PlannerSpotCandidate {
  key: string;
  zoneId: string;
  zoneName: string;
  zoneFlyerScore: number;
  spot: FlyerSpot;
  baseSessionProspects: number;
  baseAssignmentScore: number;
}

interface CandidateEvaluation {
  candidate: PlannerSpotCandidate;
  expectedProspects: number;
  expectedProspectsPerHour: number;
  expectedFlyers: number;
  assignmentScore: number;
  stackFactor: number;
  zoneRepeatPenalty: number;
  spacingPenalty: number;
}

export function planFlyerAssignments(
  flyerScores: FlyerZoneScore[],
  ctx: FlyerTimeContext,
  input: FlyerPlannerInput,
): FlyerPlan {
  const safeInput: FlyerPlannerInput = {
    teamSize: Math.max(1, Math.min(12, Math.round(input.teamSize))),
    sessionHours: Math.max(1, Math.min(6, Math.round(input.sessionHours))),
  };
  const candidates = buildPlannerCandidates(flyerScores, safeInput);
  const bestBaseProspects = Math.max(
    0,
    ...candidates.map((candidate) => candidate.baseSessionProspects),
  );
  const minimumAcceptableProspects = Math.max(
    safeInput.sessionHours * 45,
    bestBaseProspects * 0.24,
  );

  const assignments: FlyerPlanAssignment[] = [];

  for (let personIndex = 1; personIndex <= safeInput.teamSize; personIndex += 1) {
    const bestOption = chooseBestCandidate(candidates, assignments, safeInput);

    if (!bestOption || bestOption.expectedProspects < minimumAcceptableProspects) {
      assignments.push({
        personIndex,
        status: "holdback",
        zoneId: null,
        zoneName: null,
        spot: null,
        expectedProspects: 0,
        expectedProspectsPerHour: 0,
        expectedFlyers: 0,
        assignmentScore: 0,
        stackFactor: 0,
        zoneRepeatPenalty: 0,
        spacingPenalty: 0,
        rationale: bestOption
          ? `Hold this person back. The best remaining placement only models ~${Math.round(bestOption.expectedProspectsPerHour)}/hr after overlap penalties.`
          : "Hold this person back. No remaining spot clears the minimum quality bar for this time block.",
      });
      continue;
    }

    assignments.push({
      personIndex,
      status: "assigned",
      zoneId: bestOption.candidate.zoneId,
      zoneName: bestOption.candidate.zoneName,
      spot: bestOption.candidate.spot,
      expectedProspects: Math.round(bestOption.expectedProspects),
      expectedProspectsPerHour: Math.round(bestOption.expectedProspectsPerHour),
      expectedFlyers: Math.round(bestOption.expectedFlyers),
      assignmentScore: round(bestOption.assignmentScore, 0),
      stackFactor: round(bestOption.stackFactor, 2),
      zoneRepeatPenalty: round(bestOption.zoneRepeatPenalty, 2),
      spacingPenalty: round(bestOption.spacingPenalty, 2),
      rationale: buildAssignmentRationale(bestOption),
    });
  }

  const assigned = assignments.filter(
    (assignment) => assignment.status === "assigned" && assignment.spot,
  );
  const uniqueZoneCount = new Set(assigned.map((assignment) => assignment.zoneId)).size;
  const uniqueSpotCount = new Set(
    assigned.map((assignment) => plannerSpotKey(assignment.spot!)),
  ).size;
  const totalExpectedProspects = assigned.reduce(
    (sum, assignment) => sum + assignment.expectedProspects,
    0,
  );
  const totalExpectedFlyers = assigned.reduce(
    (sum, assignment) => sum + assignment.expectedFlyers,
    0,
  );
  const holdbackCount = safeInput.teamSize - assigned.length;
  const summary = holdbackCount === 0
    ? `Deploy all ${safeInput.teamSize} people for ${formatFlyerTimeLabel(ctx)} across ${uniqueZoneCount} zone${uniqueZoneCount === 1 ? "" : "s"}.`
    : `Deploy ${assigned.length} of ${safeInput.teamSize} people for ${formatFlyerTimeLabel(ctx)}. Hold ${holdbackCount} back because the remaining spots overlap too heavily or drop below the quality bar.`;

  return {
    input: safeInput,
    assignedCount: assigned.length,
    holdbackCount,
    totalExpectedProspects,
    totalExpectedFlyers,
    uniqueZoneCount,
    uniqueSpotCount,
    summary,
    assignments,
  };
}

function buildPlannerCandidates(
  flyerScores: FlyerZoneScore[],
  input: FlyerPlannerInput,
): PlannerSpotCandidate[] {
  const deduped = new Map<string, PlannerSpotCandidate>();

  for (const zoneScore of flyerScores) {
    for (const spot of zoneScore.allSpots) {
      const key = plannerSpotKey(spot);
      const baseSessionProspects = spot.prospectsPerHour * input.sessionHours;
      const spotQuality = 0.6 + 0.4 * spot.interactionQuality;
      const zoneStrength = 0.75 + 0.25 * (zoneScore.flyerScore / 100);
      const candidate: PlannerSpotCandidate = {
        key,
        zoneId: zoneScore.zone.id,
        zoneName: zoneScore.zone.name,
        zoneFlyerScore: zoneScore.flyerScore,
        spot,
        baseSessionProspects,
        baseAssignmentScore: baseSessionProspects * spotQuality * zoneStrength,
      };

      const current = deduped.get(key);
      if (!current || candidate.baseAssignmentScore > current.baseAssignmentScore) {
        deduped.set(key, candidate);
      }
    }
  }

  return Array.from(deduped.values()).sort(
    (left, right) => right.baseAssignmentScore - left.baseAssignmentScore,
  );
}

function chooseBestCandidate(
  candidates: PlannerSpotCandidate[],
  currentAssignments: FlyerPlanAssignment[],
  input: FlyerPlannerInput,
): CandidateEvaluation | null {
  let best: CandidateEvaluation | null = null;

  for (const candidate of candidates) {
    const evaluation = evaluateCandidate(candidate, currentAssignments, input);
    if (!evaluation) {
      continue;
    }

    if (!best || evaluation.assignmentScore > best.assignmentScore) {
      best = evaluation;
    }
  }

  return best;
}

function evaluateCandidate(
  candidate: PlannerSpotCandidate,
  currentAssignments: FlyerPlanAssignment[],
  input: FlyerPlannerInput,
): CandidateEvaluation | null {
  const assigned = currentAssignments.filter(
    (assignment) => assignment.status === "assigned" && assignment.spot,
  );
  const sameSpotCount = assigned.filter(
    (assignment) => plannerSpotKey(assignment.spot!) === candidate.key,
  ).length;

  if (sameSpotCount >= 2) {
    return null;
  }

  const zoneRepeatCount = assigned.filter(
    (assignment) => assignment.zoneId === candidate.zoneId,
  ).length;
  const nearestAssignedDistanceKm = Math.min(
    ...assigned.map((assignment) =>
      distanceKm(
        { lat: assignment.spot!.lat, lon: assignment.spot!.lon },
        { lat: candidate.spot.lat, lon: candidate.spot.lon },
      ),
    ),
    Number.POSITIVE_INFINITY,
  );

  const stackFactor = sameSpotCount === 0 ? 1 : SECOND_PERSON_STACK_FACTOR;
  const zoneRepeatPenalty = Math.pow(ZONE_REPEAT_DECAY, zoneRepeatCount);
  const spacingPenalty = getSpacingPenalty(nearestAssignedDistanceKm);
  const assignmentScore =
    candidate.baseAssignmentScore * stackFactor * zoneRepeatPenalty * spacingPenalty;
  const expectedProspects =
    candidate.baseSessionProspects * stackFactor * zoneRepeatPenalty * spacingPenalty;

  return {
    candidate,
    expectedProspects,
    expectedProspectsPerHour: expectedProspects / input.sessionHours,
    expectedFlyers: expectedProspects * TAKE_RATE,
    assignmentScore,
    stackFactor,
    zoneRepeatPenalty,
    spacingPenalty,
  };
}

function getSpacingPenalty(distanceKmValue: number) {
  if (!Number.isFinite(distanceKmValue)) {
    return 1;
  }

  if (distanceKmValue < 0.25) {
    return 0.35;
  }

  if (distanceKmValue < 0.6) {
    return 0.7;
  }

  if (distanceKmValue < 1) {
    return 0.88;
  }

  return 1;
}

function buildAssignmentRationale(evaluation: CandidateEvaluation) {
  const rationale: string[] = [
    `${evaluation.candidate.zoneName} is still the strongest remaining zone for this person.`,
  ];

  if (evaluation.stackFactor < 1) {
    rationale.push("This is the second rep at the same spot, so the expected yield is discounted for overlap.");
  } else if (evaluation.spacingPenalty < 1) {
    rationale.push("The planner kept a spacing penalty because another rep is working nearby.");
  } else {
    rationale.push("This placement stays well separated from the rest of the team.");
  }

  if (evaluation.zoneRepeatPenalty < 1) {
    rationale.push("Zone-repeat decay was applied to avoid overloading one area too early.");
  }

  return rationale.join(" ");
}

function plannerSpotKey(spot: FlyerSpot) {
  return `${spot.type}:${spot.lat.toFixed(4)}:${spot.lon.toFixed(4)}:${spot.name}`;
}
