import type { ReactNode } from "react";

import type {
  AreaAnalysisCircle,
  AreaAnalysisSummary,
  FlyerConditions,
  FlyerPlan,
  FlyerPlannerInput,
  FlyerTimeContext,
  FlyerZoneScore,
  Mode,
  TimeSlice,
  ZoneScore,
} from "@/lib/types";
import { getModeAccent } from "@/lib/types";
import { describeDistrictContext } from "@/lib/berlin-enrichment";
import { round } from "@/lib/geo";
import { buildZoneInsights } from "@/lib/zone-insights";
import { buildAreaActionSteps, getCounterMetricForTimeSlice, isPointInsideCircle } from "@/lib/area-analysis";
import { formatFlyerTimeLabel } from "@/lib/time-model";
import css from "./ground-signal.module.css";

interface IntelPanelProps {
  mode: Mode;
  timeSlice: TimeSlice;
  flyerTimeContext: FlyerTimeContext;
  flyerConditions: FlyerConditions | null;
  flyerConditionsStatus: "idle" | "loading" | "ready" | "error";
  flyerPlan: FlyerPlan | null;
  flyerPlannerInput: FlyerPlannerInput;
  scores: ZoneScore[];
  flyerScores: FlyerZoneScore[];
  analysisEnabled: boolean;
  placementMode: boolean;
  analysisCircle: AreaAnalysisCircle;
  analysisSummary: AreaAnalysisSummary | null;
  selectedZoneId: string | null;
  onClosePanel: () => void;
  onSelectZone: (id: string) => void;
  onClearArea: () => void;
}

export default function IntelPanel({
  mode,
  timeSlice,
  flyerTimeContext,
  flyerConditions,
  flyerConditionsStatus,
  flyerPlan,
  flyerPlannerInput,
  scores,
  flyerScores,
  analysisEnabled,
  placementMode,
  analysisCircle,
  analysisSummary,
  selectedZoneId,
  onClosePanel,
  onSelectZone,
  onClearArea,
}: IntelPanelProps) {
  const accent = getModeAccent(mode);
  const isFlyerMode = mode === "flyer-distribution";

  const activeScores = isFlyerMode ? flyerScores : scores;
  const top10 = activeScores.slice(0, 10);
  const selected = isFlyerMode
    ? flyerScores.find((s) => s.zone.id === selectedZoneId) ?? null
    : scores.find((score) => score.zone.id === selectedZoneId) ?? null;
  const showAreaAnalysis = analysisEnabled || Boolean(analysisSummary);

  return (
    <div className={css.intelPanel}>
      <div className={css.intelHeader}>
        <div className={css.intelHeaderRow}>
          <div className={css.intelTitle}>
            {isFlyerMode ? "Deployment planner + top flyer zones" : "Top opportunity zones"}
          </div>
          <button className={css.sectionHeaderAction} onClick={onClosePanel} type="button">
            Map only
          </button>
        </div>
        <label className={css.zonePickerLabel} htmlFor="zone-picker">
          Selected zone
        </label>
        <select
          className={css.zonePicker}
          id="zone-picker"
          onChange={(event) => onSelectZone(event.target.value)}
          value={selected?.zone.id ?? activeScores[0]?.zone.id ?? ""}
        >
          {activeScores.map((score, index) => (
            <option key={score.zone.id} value={score.zone.id}>
              {index + 1}. {score.zone.name}
            </option>
          ))}
        </select>

        {isFlyerMode && flyerPlan ? (
          <div className={css.plannerHeaderCard}>
            <div className={css.plannerHeaderTop}>
              <div className={css.plannerHeaderTitle}>Today&apos;s deployment</div>
              <div className={css.plannerHeaderText}>{flyerPlan.summary}</div>
            </div>

            <div className={css.plannerHeaderStats}>
              <div className={css.plannerHeaderStat}>
                <strong>{flyerPlan.input.teamSize}</strong>
                <span>reps</span>
              </div>
              <div className={css.plannerHeaderStat}>
                <strong>{flyerPlan.assignedCount}</strong>
                <span>active</span>
              </div>
              <div className={css.plannerHeaderStat}>
                <strong>{flyerPlan.holdbackCount}</strong>
                <span>hold</span>
              </div>
              <div className={css.plannerHeaderStat}>
                <strong>{flyerPlan.totalExpectedFlyers.toLocaleString()}</strong>
                <span>flyers</span>
              </div>
            </div>

            <div className={css.plannerHeaderAssignments}>
              {flyerPlan.assignments.slice(0, 3).map((assignment) => (
                <div className={css.plannerHeaderAssignment} key={assignment.personIndex}>
                  <strong>Person {assignment.personIndex}</strong>
                  <span>
                    {assignment.status === "assigned" && assignment.spot
                      ? `${assignment.spot.name} · ${assignment.expectedProspectsPerHour}/hr`
                      : "Hold back for a stronger slot"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className={css.zoneList}>
        {top10.map((score, index) => {
          const displayScore = isFlyerMode
            ? (score as FlyerZoneScore).flyerScore
            : (score as ZoneScore).opportunity;
          const subLabel = isFlyerMode
            ? `${(score as FlyerZoneScore).prospectsPerHour}/hr`
            : undefined;

          return (
            <div
              key={score.zone.id}
              className={`${css.zoneRow} ${selectedZoneId === score.zone.id ? css.zoneRowActive : ""}`}
              onClick={() => onSelectZone(score.zone.id)}
            >
              <span className={css.zoneRank}>{index + 1}</span>
              <div>
                <div className={css.zoneName}>{score.zone.name}</div>
                {subLabel && (
                  <div className={css.zoneSubLabel}>
                    {subLabel} prospects
                  </div>
                )}
                <div
                  className={css.zoneBar}
                  style={{
                    width: `${displayScore}%`,
                    background: accent,
                    opacity: selectedZoneId === score.zone.id ? 1 : 0.5,
                  }}
                />
              </div>
              <span className={css.zoneScore} style={{ color: accent }}>
                {round(displayScore, 0)}
              </span>
            </div>
          );
        })}
      </div>

      <div className={css.intelCard}>
        {showAreaAnalysis ? (
          <>
            {isFlyerMode ? (
              <FlyerAreaIntelCard
                analysisCircle={analysisCircle}
                placementMode={placementMode}
                summary={analysisSummary}
                flyerTimeContext={flyerTimeContext}
                flyerConditions={flyerConditions}
                flyerConditionsStatus={flyerConditionsStatus}
                flyerScores={flyerScores}
                accent={accent}
                onClearArea={onClearArea}
              />
            ) : (
              <AreaIntelCard
                analysisCircle={analysisCircle}
                placementMode={placementMode}
                summary={analysisSummary}
                timeSlice={timeSlice}
                onClearArea={onClearArea}
              />
            )}
            <div className={css.intelDivider} />
          </>
        ) : null}

        {isFlyerMode && flyerPlan ? (
          <>
            <FlyerPlannerCard
              accent={accent}
              flyerPlan={flyerPlan}
              flyerPlannerInput={flyerPlannerInput}
              flyerTimeContext={flyerTimeContext}
              onSelectZone={onSelectZone}
            />
            <div className={css.intelDivider} />
          </>
        ) : null}

        {isFlyerMode ? (
          selected === null ? (
            <div className={css.intelEmpty}>
              Click a zone on the map or in the list above to see flyer recommendations
            </div>
          ) : (
            <FlyerIntelCard
              score={selected as FlyerZoneScore}
              accent={accent}
              flyerTimeContext={flyerTimeContext}
              flyerConditions={flyerConditions}
              flyerConditionsStatus={flyerConditionsStatus}
            />
          )
        ) : !selected ? (
          <div className={css.intelEmpty}>
            Click a zone on the map or in the list above to see intelligence
          </div>
        ) : (
          <ZoneIntelCard mode={mode} score={selected as ZoneScore} accent={accent} timeSlice={timeSlice} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flyer Intel Card
// ---------------------------------------------------------------------------

const SPOT_TYPE_LABELS: Record<string, string> = {
  "br-stop": "B+R Stop",
  "station-entrance": "Station",
  "protected-lane": "Bike Lane",
  "bike-street": "Bike Street",
  "shop-cluster": "Shop Cluster",
};

const AUDIENCE_LABELS: Record<string, string> = {
  student: "Student",
  commuter: "Commuter",
  "office-worker": "Office Worker",
  leisure: "Leisure",
  residential: "Residential",
};

const AUDIENCE_ICONS: Record<string, string> = {
  student: "\u{1F393}",
  commuter: "\u{1F689}",
  "office-worker": "\u{1F4BC}",
  leisure: "\u{1F333}",
  residential: "\u{1F3D8}\u{FE0F}",
};

function FlyerIntelCard({
  score,
  accent,
  flyerTimeContext,
  flyerConditions,
  flyerConditionsStatus,
}: {
  score: FlyerZoneScore;
  accent: string;
  flyerTimeContext: FlyerTimeContext;
  flyerConditions: FlyerConditions | null;
  flyerConditionsStatus: "idle" | "loading" | "ready" | "error";
}) {
  const districtContext = score.districtContext;
  const topTransitDisruption = score.factorBreakdown.topTransitDisruption;

  return (
    <>
      <div className={css.headline}>{score.headline}</div>
      <div className={css.zoneSubtitle}>
        Selected zone: <strong>{score.zone.name}</strong> · {formatFlyerTimeLabel(flyerTimeContext)}
      </div>

      <div className={css.meters}>
        <Meter label="Cyclist Vol." value={score.cyclistVolumeScore} color={accent} />
        <Meter label="Dwell Opp." value={score.dwellScore} color="#8b5cf6" />
        <Meter label="Infra" value={score.infraScore} color="#d4a017" />
      </div>

      <div className={css.numbers}>
        <MetricCard
          label="cyclists/hr"
          value={score.estimatedCyclistsPerHour.toLocaleString()}
        />
        <MetricCard
          label="prospects/hr"
          value={score.prospectsPerHour.toLocaleString()}
        />
        <MetricCard
          label="audience fit"
          value={`${round(score.audienceFitScore, 0)}/100`}
        />
        <MetricCard
          label="brand affinity"
          value={`${round(score.affinityScore, 0)}/100`}
        />
        <MetricCard
          label="repair shops"
          value={score.zone.shopCount.toString()}
        />
        <MetricCard
          label="nearby stations"
          value={score.zone.nearbyStations.length.toString()}
        />
        <MetricCard
          label="weather mult."
          value={`${formatSignedPercent(score.factorBreakdown.weatherMultiplier - 1)}`}
        />
        <MetricCard
          label="transit boost"
          value={`${formatSignedPercent(score.factorBreakdown.transitDisruptionBoost - 1)}`}
        />
        <MetricCard
          label="repair proxy"
          value={`${score.factorBreakdown.repairDemandScore}/100`}
        />
        <MetricCard
          label="bike theft /1k"
          value={score.factorBreakdown.bikeTheftDensity.toFixed(1)}
        />
      </div>

      <Section title="Live factors">
        <div className={css.infoList}>
          <div className={css.infoRow}>
            <strong>Weather</strong>
            <span>
              {flyerConditions?.weather?.summary
                ?? (flyerConditionsStatus === "loading"
                  ? "Loading selected-window forecast..."
                  : "No weather adjustment loaded")}
            </span>
          </div>
          <div className={css.infoRow}>
            <strong>Transit</strong>
            <span>
              {topTransitDisruption
                ? `${topTransitDisruption.stationName}: ${topTransitDisruption.summary}`
                : flyerConditionsStatus === "loading"
                  ? "Loading transit disruption signal..."
                  : "No notable station disruption boost"}
            </span>
          </div>
          <div className={css.infoRow}>
            <strong>District</strong>
            <span>
              {districtContext.districtName
                ? `${districtContext.districtName} · ${describeDistrictContext(districtContext)}`
                : "District context unavailable"}
            </span>
          </div>
        </div>
      </Section>

      {districtContext.districtName && districtContext.socioeconomic ? (
        <Section title="District repair priors">
          <div className={css.infoList}>
            <div className={css.infoRow}>
              <strong>Car-free households</strong>
              <span>{formatPercent(districtContext.socioeconomic.carFreeHouseholdsShare)}</span>
            </div>
            <div className={css.infoRow}>
              <strong>Purchasing power index</strong>
              <span>{districtContext.socioeconomic.purchasingPowerIndex}</span>
            </div>
            <div className={css.infoRow}>
              <strong>Unemployment</strong>
              <span>{districtContext.socioeconomic.unemploymentRate.toFixed(1)}%</span>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="Team & flyer advice">
        <div
          className={`${css.actionCard} ${css.accentCard}`}
          style={{ background: accent + "12", borderLeft: `3px solid ${accent}` }}
        >
          {score.teamAdvice}
        </div>
      </Section>

      <Section title="Where to stand">
        {score.topSpots.length === 0 ? (
          <div className={css.infoEmpty}>No specific spots identified for this zone.</div>
        ) : (
          <div className={css.infoList}>
            {score.topSpots.map((spot, i) => (
              <div key={i} className={css.spotCard}>
                <div className={css.spotCardHeader}>
                  <span className={css.spotChip}>
                    {SPOT_TYPE_LABELS[spot.type] ?? spot.type}
                  </span>
                  <strong className={css.spotTitle}>{spot.name}</strong>
                  <span className={css.spotValue}>
                    {spot.prospectsPerHour}/hr
                  </span>
                </div>
                <div className={css.spotHint}>
                  {spot.positioningHint}
                </div>
                <div className={css.spotMeta}>
                  ~{spot.estimatedCyclistsPerHour} cyclists/hr · {Math.round(spot.interactionQuality * 100)}% take rate · {Math.round(spot.audienceFit * 100)}% audience fit
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Best time windows for this zone">
        {score.bestWindows.length === 0 ? (
          <div className={css.infoEmpty}>No window data available.</div>
        ) : (
          <div className={css.infoList}>
            {score.bestWindows.map((win, i) => (
              <div key={i} className={css.windowCard}>
                <div className={css.windowMain}>
                  <div className={css.windowLabel}>{win.label}</div>
                  <div
                    className={css.windowBar}
                    style={{
                      width: `${win.flyerScore}%`,
                      background: accent,
                    }}
                  />
                </div>
                <span className={css.windowValue}>
                  {win.prospectsPerHour}/hr
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recommendation">
        <div
          className={`${css.actionCard} ${css.supportCard}`}
          style={{ borderLeft: `3px solid ${accent}` }}
        >
          {score.recommendation}
        </div>
      </Section>
    </>
  );
}

function FlyerPlannerCard({
  accent,
  flyerPlan,
  flyerPlannerInput,
  flyerTimeContext,
  onSelectZone,
}: {
  accent: string;
  flyerPlan: FlyerPlan;
  flyerPlannerInput: FlyerPlannerInput;
  flyerTimeContext: FlyerTimeContext;
  onSelectZone: (id: string) => void;
}) {
  const assigned = flyerPlan.assignments.filter(
    (assignment) => assignment.status === "assigned" && assignment.spot,
  );

  return (
    <>
      <div className={css.sectionHeaderRow}>
        <div>
          <div className={css.sectionLabel}>Field deployment plan</div>
          <div className={css.zoneSubtitle}>
            {flyerPlan.summary}
          </div>
        </div>
      </div>

      <div className={css.numbers}>
        <MetricCard label="team size" value={flyerPlan.input.teamSize.toString()} />
        <MetricCard label="active now" value={flyerPlan.assignedCount.toString()} />
        <MetricCard label="hold back" value={flyerPlan.holdbackCount.toString()} />
        <MetricCard label="session" value={`${flyerPlannerInput.sessionHours}h`} />
        <MetricCard
          label="expected prospects"
          value={flyerPlan.totalExpectedProspects.toLocaleString()}
        />
        <MetricCard
          label="expected flyers"
          value={flyerPlan.totalExpectedFlyers.toLocaleString()}
        />
        <MetricCard label="zones covered" value={flyerPlan.uniqueZoneCount.toString()} />
        <MetricCard label="spots used" value={flyerPlan.uniqueSpotCount.toString()} />
      </div>

      <Section title="Why this split">
        <div
          className={`${css.actionCard} ${css.supportCard}`}
          style={{ borderLeft: `3px solid ${accent}` }}
        >
          For {formatFlyerTimeLabel(flyerTimeContext)}, the planner assigns people one by one to the strongest remaining spots, then discounts overlap at the same spot, nearby crowding, and repeated stacking in the same zone.
        </div>
      </Section>

      <Section title="Person-by-person plan">
        <div className={css.assignmentList}>
          {flyerPlan.assignments.map((assignment) =>
            assignment.status === "assigned" && assignment.spot ? (
              <button
                key={assignment.personIndex}
                className={css.assignmentCardButton}
                onClick={() => {
                  if (assignment.zoneId) {
                    onSelectZone(assignment.zoneId);
                  }
                }}
                type="button"
              >
                <div className={css.assignmentCardHeader}>
                  <span className={css.assignmentBadge}>Person {assignment.personIndex}</span>
                  <span className={css.assignmentValue}>
                    {assignment.expectedProspectsPerHour}/hr
                  </span>
                </div>
                <div className={css.assignmentTitle}>{assignment.spot.name}</div>
                <div className={css.assignmentMeta}>
                  {assignment.zoneName} · {SPOT_TYPE_LABELS[assignment.spot.type] ?? assignment.spot.type} · ~{assignment.expectedFlyers} flyers
                </div>
                <div className={css.assignmentHint}>{assignment.rationale}</div>
              </button>
            ) : (
              <div
                key={assignment.personIndex}
                className={`${css.assignmentCard} ${css.assignmentCardHoldback}`}
              >
                <div className={css.assignmentCardHeader}>
                  <span className={css.assignmentBadge}>Person {assignment.personIndex}</span>
                  <span className={css.assignmentValue}>Hold back</span>
                </div>
                <div className={css.assignmentTitle}>Keep flexible for the next block</div>
                <div className={css.assignmentHint}>{assignment.rationale}</div>
              </div>
            ),
          )}
        </div>
      </Section>

      {assigned.length > 0 ? (
        <Section title="Fast brief">
          <ol className={css.actionList}>
            {assigned.slice(0, 3).map((assignment) => (
              <li className={css.actionListItem} key={assignment.personIndex}>
                <strong>Person {assignment.personIndex}: {assignment.spot!.name}</strong>
                <span>
                  {assignment.zoneName} · ~{assignment.expectedProspectsPerHour}/hr prospects · click the numbered map pin to inspect the zone.
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section title="Session economics">
        <SessionROICard flyerPlan={flyerPlan} flyerPlannerInput={flyerPlannerInput} />
      </Section>

      <button
        className={css.exportButton}
        onClick={() => exportFlyerPlanPDF(flyerPlan, flyerPlannerInput, flyerTimeContext)}
        type="button"
      >
        Export briefing (PDF)
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Session ROI Card
// ---------------------------------------------------------------------------

const HOURLY_REP_COST_EUR = 14;    // avg hourly cost per rep (wages + overhead)
const FLYER_UNIT_COST_EUR = 0.04;  // print cost per flyer

function SessionROICard({
  flyerPlan,
  flyerPlannerInput,
}: {
  flyerPlan: FlyerPlan;
  flyerPlannerInput: FlyerPlannerInput;
}) {
  const activeReps = flyerPlan.assignedCount;
  const hours = flyerPlannerInput.sessionHours;
  const laborCost = activeReps * hours * HOURLY_REP_COST_EUR;
  const flyerCost = flyerPlan.totalExpectedFlyers * FLYER_UNIT_COST_EUR;
  const totalCost = laborCost + flyerCost;
  const costPerProspect = flyerPlan.totalExpectedProspects > 0
    ? totalCost / flyerPlan.totalExpectedProspects
    : 0;
  const costPerFlyer = flyerPlan.totalExpectedFlyers > 0
    ? totalCost / flyerPlan.totalExpectedFlyers
    : 0;
  // Assume 3% conversion from prospect → lead
  const estimatedLeads = Math.round(flyerPlan.totalExpectedProspects * 0.03);
  const costPerLead = estimatedLeads > 0 ? totalCost / estimatedLeads : 0;

  return (
    <div className={css.roiCard}>
      <div className={css.roiRow}>
        <span>Team cost ({activeReps} reps × {hours}h × €{HOURLY_REP_COST_EUR})</span>
        <strong>€{laborCost.toFixed(0)}</strong>
      </div>
      <div className={css.roiRow}>
        <span>Print cost ({flyerPlan.totalExpectedFlyers} × €{FLYER_UNIT_COST_EUR})</span>
        <strong>€{flyerCost.toFixed(1)}</strong>
      </div>
      <div className={`${css.roiRow} ${css.roiRowTotal}`}>
        <span>Total session cost</span>
        <strong>€{totalCost.toFixed(0)}</strong>
      </div>
      <div className={css.roiDivider} />
      <div className={css.roiRow}>
        <span>Cost per prospect</span>
        <strong>€{costPerProspect.toFixed(2)}</strong>
      </div>
      <div className={css.roiRow}>
        <span>Cost per flyer distributed</span>
        <strong>€{costPerFlyer.toFixed(2)}</strong>
      </div>
      <div className={css.roiRow}>
        <span>Est. leads (3% conversion)</span>
        <strong>{estimatedLeads}</strong>
      </div>
      <div className={`${css.roiRow} ${css.roiRowHighlight}`}>
        <span>Cost per lead</span>
        <strong>€{costPerLead.toFixed(2)}</strong>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF Export
// ---------------------------------------------------------------------------

function exportFlyerPlanPDF(
  plan: FlyerPlan,
  input: FlyerPlannerInput,
  ctx: FlyerTimeContext,
) {
  const assigned = plan.assignments.filter(
    (a) => a.status === "assigned" && a.spot,
  );
  const laborCost = plan.assignedCount * input.sessionHours * HOURLY_REP_COST_EUR;
  const flyerCost = plan.totalExpectedFlyers * FLYER_UNIT_COST_EUR;
  const totalCost = laborCost + flyerCost;
  const costPerProspect = plan.totalExpectedProspects > 0
    ? (totalCost / plan.totalExpectedProspects).toFixed(2)
    : "—";
  const estimatedLeads = Math.round(plan.totalExpectedProspects * 0.03);
  const costPerLead = estimatedLeads > 0 ? (totalCost / estimatedLeads).toFixed(2) : "—";
  const dayLabel = ctx.day.charAt(0).toUpperCase() + ctx.day.slice(1);

  const lines = [
    "BETTERIDE — FLYER DEPLOYMENT BRIEFING",
    "=".repeat(44),
    "",
    `Date:     ${new Date().toLocaleDateString("de-DE")}`,
    `Window:   ${dayLabel} · ${ctx.timeBlock.replace("-", " ")}`,
    `Team:     ${plan.input.teamSize} reps (${plan.assignedCount} active, ${plan.holdbackCount} holdback)`,
    `Session:  ${input.sessionHours}h`,
    "",
    "ASSIGNMENTS",
    "-".repeat(44),
    "",
    ...assigned.map(
      (a) =>
        `  Person ${a.personIndex}: ${a.spot!.name}\n` +
        `    Zone: ${a.zoneName}\n` +
        `    Prospects/hr: ~${a.expectedProspectsPerHour}  |  Flyers: ~${a.expectedFlyers}\n` +
        `    Tip: ${a.spot!.positioningHint}\n`,
    ),
    "",
    "SESSION ECONOMICS",
    "-".repeat(44),
    "",
    `  Team cost:         €${laborCost.toFixed(0)}`,
    `  Print cost:        €${flyerCost.toFixed(1)}`,
    `  Total:             €${totalCost.toFixed(0)}`,
    "",
    `  Expected prospects: ${plan.totalExpectedProspects.toLocaleString()}`,
    `  Expected flyers:    ${plan.totalExpectedFlyers.toLocaleString()}`,
    `  Cost/prospect:      €${costPerProspect}`,
    `  Est. leads (3%):    ${estimatedLeads}`,
    `  Cost/lead:          €${costPerLead}`,
    "",
    "=".repeat(44),
    "Generated by Betteride Ground Signal",
  ];

  const text = lines.join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `betteride-briefing-${ctx.day}-${ctx.timeBlock}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function FlyerAreaIntelCard({
  analysisCircle,
  placementMode,
  summary,
  flyerTimeContext,
  flyerConditions,
  flyerConditionsStatus,
  flyerScores,
  accent,
  onClearArea,
}: {
  analysisCircle: AreaAnalysisCircle;
  placementMode: boolean;
  summary: AreaAnalysisSummary | null;
  flyerTimeContext: FlyerTimeContext;
  flyerConditions: FlyerConditions | null;
  flyerConditionsStatus: "idle" | "loading" | "ready" | "error";
  flyerScores: FlyerZoneScore[];
  accent: string;
  onClearArea: () => void;
}) {
  // Find zones that overlap with the area circle
  const nearbyZones = analysisCircle.center
    ? flyerScores.filter((fs) =>
        isPointInsideCircle({ lat: fs.zone.lat, lon: fs.zone.lon }, analysisCircle),
      )
    : [];
  const bestZone = nearbyZones[0] ?? null;

  // Collect all top spots from zones in the area
  const areaSpots = nearbyZones
    .flatMap((fs) => fs.topSpots)
    .sort((a, b) => b.prospectsPerHour - a.prospectsPerHour)
    .slice(0, 5);

  return (
    <>
      <div className={css.sectionHeaderRow}>
        <div>
          <div className={css.sectionLabel}>Your area — flyer recommendations</div>
          <div className={css.zoneSubtitle}>
            {summary && analysisCircle.center
              ? `${round(analysisCircle.radiusKm, 2)} km radius · ${formatFlyerTimeLabel(flyerTimeContext)} · ${nearbyZones.length} zone${nearbyZones.length !== 1 ? "s" : ""} in range`
              : placementMode
                ? "Click the map to place your area, then see the best flyer spots nearby."
                : "Tap \"My Area\" to mark where you are and get spot-level flyer recommendations."}
          </div>
        </div>
        {summary ? (
          <button className={css.sectionHeaderAction} onClick={onClearArea} type="button">
            Clear
          </button>
        ) : null}
      </div>

      {!summary ? (
        <div className={css.infoEmpty}>
          {placementMode
            ? "Click anywhere on the map to place your area circle."
            : "No area selected yet."}
        </div>
      ) : (
        <>
          {/* Audience segment banner */}
          {summary.audienceSegment ? (
            <div className={css.audienceBanner}>
              <span className={css.audienceIcon}>
                {AUDIENCE_ICONS[summary.audienceSegment] ?? ""}
              </span>
              <div>
                <div className={css.audienceTitle}>
                  {AUDIENCE_LABELS[summary.audienceSegment] ?? summary.audienceSegment} area
                </div>
                <div className={css.audienceDetail}>
                  {summary.audienceDetail}
                </div>
              </div>
            </div>
          ) : null}

          <div className={css.numbers}>
            <MetricCard
              label="modeled cyclists/hr"
              value={summary.estimatedCyclistsThroughArea.toLocaleString()}
            />
            <MetricCard
              label="best zone prospects/hr"
              value={bestZone ? bestZone.prospectsPerHour.toLocaleString() : "—"}
            />
            <MetricCard label="zones in area" value={nearbyZones.length.toString()} />
            <MetricCard label="stations" value={summary.stationCount.toString()} />
            <MetricCard label="bike sharing" value={summary.bikeSharingCount.toString()} />
            <MetricCard label="universities" value={summary.universityCount.toString()} />
            <MetricCard label="office hubs" value={summary.officeAreaCount.toString()} />
            <MetricCard label="repair shops" value={summary.shopCount.toString()} />
            <MetricCard label="partners" value={summary.partnerCount.toString()} />
            {summary.districtContext?.populationDensity != null ? (
              <MetricCard
                label="pop. density/km²"
                value={Math.round(summary.districtContext.populationDensity).toLocaleString()}
              />
            ) : null}
            {summary.districtContext?.cyclingModalShare != null ? (
              <MetricCard
                label="cycling share"
                value={`${Math.round(summary.districtContext.cyclingModalShare * 100)}%`}
              />
            ) : null}
            {summary.districtContext?.repairDemandScore != null ? (
              <MetricCard
                label="repair proxy"
                value={`${summary.districtContext.repairDemandScore}/100`}
              />
            ) : null}
            <MetricCard
              label="confidence"
              value={formatConfidenceLabel(summary.estimateConfidence)}
            />
          </div>

          <Section title="Dynamic adjustments">
            <div className={css.infoList}>
              <div className={css.infoRow}>
                <strong>Weather</strong>
                <span>
                  {flyerConditions?.weather?.summary
                    ?? (flyerConditionsStatus === "loading"
                      ? "Loading selected-window forecast..."
                      : "Weather adjustment unavailable")}
                </span>
              </div>
              <div className={css.infoRow}>
                <strong>Top transit stress</strong>
                <span>
                  {bestZone?.factorBreakdown.topTransitDisruption
                    ? `${bestZone.factorBreakdown.topTransitDisruption.stationName}: ${bestZone.factorBreakdown.topTransitDisruption.summary}`
                    : "No notable disruption boost in overlapping zones"}
                </span>
              </div>
              <div className={css.infoRow}>
                <strong>District</strong>
                <span>
                  {summary.districtContext?.districtName
                    ? `${summary.districtContext.districtName} · ${describeDistrictContext(summary.districtContext)}`
                    : "District context unavailable"}
                </span>
              </div>
            </div>
          </Section>

          {/* Flyer tone recommendation */}
          {summary.flyerTone ? (
            <Section title="Suggested flyer message">
              <div
                className={`${css.actionCard} ${css.supportCard}`}
                style={{ borderLeft: `3px solid ${accent}`, fontSize: 12 }}
              >
                <strong>Tone:</strong> {summary.flyerTone}
              </div>
            </Section>
          ) : null}

          {areaSpots.length > 0 ? (
            <Section title="Best spots in your area">
              <div className={css.infoList}>
                {areaSpots.map((spot, i) => (
                  <div key={i} className={css.spotCard}>
                    <div className={css.spotCardHeader}>
                      <span className={css.spotChip}>
                        {SPOT_TYPE_LABELS[spot.type] ?? spot.type}
                      </span>
                      <strong className={css.spotTitle}>{spot.name}</strong>
                      <span className={css.spotValue}>
                        {spot.prospectsPerHour}/hr
                      </span>
                    </div>
                    <div className={css.spotHint}>
                      {spot.positioningHint}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : (
            <div className={css.infoEmpty}>
              No specific flyer spots found in this area. Try a larger radius or different location.
            </div>
          )}

          {bestZone ? (
            <Section title="Recommendation">
              <div
                className={`${css.actionCard} ${css.supportCard}`}
                style={{ borderLeft: `3px solid ${accent}` }}
              >
                {bestZone.recommendation}
              </div>
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}

function AreaIntelCard({
  analysisCircle,
  placementMode,
  summary,
  timeSlice,
  onClearArea,
}: {
  analysisCircle: AreaAnalysisCircle;
  placementMode: boolean;
  summary: AreaAnalysisSummary | null;
  timeSlice: TimeSlice;
  onClearArea: () => void;
}) {
  const actions = summary ? buildAreaActionSteps(summary) : [];

  return (
    <>
      <div className={css.sectionHeaderRow}>
        <div>
          <div className={css.sectionLabel}>Manual area analysis</div>
          <div className={css.zoneSubtitle}>
            {summary && analysisCircle.center
              ? `${round(analysisCircle.radiusKm, 2)} km radius around your selected map point. Modeled demand blends nearby sensors, surrounding counter interpolation, and bike-corridor priors.`
              : placementMode
                ? "Click the map to place a circle, then drag the round and square handles to move or resize it."
                : "Enable Analyze Area to inspect any custom radius instead of the preset zone boundaries."}
          </div>
        </div>
        {summary ? (
          <button className={css.sectionHeaderAction} onClick={onClearArea} type="button">
            Clear
          </button>
        ) : null}
      </div>

      {!summary ? (
        <div className={css.infoEmpty}>
          {placementMode
            ? "Map placement mode is active. Click anywhere on the map to create the live analysis circle."
            : "No manual area is active yet."}
        </div>
      ) : (
        <>
          <div className={css.numbers}>
            <MetricCard
              label="modeled cyclists"
              value={summary.estimatedCyclistsThroughArea.toLocaleString()}
            />
            <MetricCard
              label={`${formatTimeSliceLabel(timeSlice)} counter volume`}
              value={summary.observedCounterVolume.toLocaleString()}
            />
            <MetricCard
              label="local sensor estimate"
              value={summary.localSensorEstimate.toLocaleString()}
            />
            <MetricCard
              label="background estimate"
              value={summary.backgroundEstimate.toLocaleString()}
            />
            <MetricCard
              label="network prior"
              value={summary.networkPriorEstimate.toLocaleString()}
            />
            <MetricCard
              label="sensor confidence"
              value={formatConfidenceLabel(summary.estimateConfidence)}
            />
            <MetricCard label="bike shops" value={summary.shopCount.toString()} />
            <MetricCard label="partners" value={summary.partnerCount.toString()} />
            <MetricCard label="independent shops" value={summary.candidateCount.toString()} />
            <MetricCard label="stations" value={summary.stationCount.toString()} />
            {summary.universityCount > 0 ? (
              <MetricCard label="universities" value={summary.universityCount.toString()} />
            ) : null}
            {summary.bikeSharingCount > 0 ? (
              <MetricCard label="bike sharing" value={summary.bikeSharingCount.toString()} />
            ) : null}
            {summary.officeAreaCount > 0 ? (
              <MetricCard label="office hubs" value={summary.officeAreaCount.toString()} />
            ) : null}
            {summary.districtContext?.repairDemandScore != null ? (
              <MetricCard
                label="repair proxy"
                value={`${summary.districtContext.repairDemandScore}/100`}
              />
            ) : null}
            {summary.districtContext?.bikeTheftDensity != null ? (
              <MetricCard
                label="bike theft /1k"
                value={summary.districtContext.bikeTheftDensity.toFixed(1)}
              />
            ) : null}
          </div>

          {summary.districtContext?.districtName && summary.districtContext.socioeconomic ? (
            <Section title="District context">
              <div className={css.infoList}>
                <div className={css.infoRow}>
                  <strong>Profile</strong>
                  <span>
                    {summary.districtContext.districtName} · {describeDistrictContext(summary.districtContext)}
                  </span>
                </div>
                <div className={css.infoRow}>
                  <strong>Car-free households</strong>
                  <span>{formatPercent(summary.districtContext.socioeconomic.carFreeHouseholdsShare)}</span>
                </div>
                <div className={css.infoRow}>
                  <strong>Purchasing power</strong>
                  <span>{summary.districtContext.socioeconomic.purchasingPowerIndex}</span>
                </div>
                <div className={css.infoRow}>
                  <strong>Unemployment</strong>
                  <span>{summary.districtContext.socioeconomic.unemploymentRate.toFixed(1)}%</span>
                </div>
              </div>
            </Section>
          ) : null}

          <Section title="Recommended action list">
            <ol className={css.actionList}>
              {actions.map((action) => (
                <li key={action.title} className={css.actionListItem}>
                  <strong>{action.title}</strong>
                  <span>{action.detail}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Partner shops in circle">
            <EntityList
              emptyState="No Betteride partner is currently inside this custom area."
              items={summary.insidePartners.slice(0, 5)}
              renderItem={(partner) => (
                <>
                  <strong>{partner.item.partnerName ?? partner.item.name}</strong>
                  <span>{round(partner.distanceKm, 1)} km · {round(partner.bikeMinutes, 1)} min</span>
                </>
              )}
            />
          </Section>

          <Section title="Independent shops to recruit">
            <EntityList
              emptyState="No independent bike shops are currently inside this custom area."
              items={summary.insideCandidates.slice(0, 6)}
              renderItem={(candidate) => (
                <>
                  <strong>{candidate.item.name}</strong>
                  <span>{round(candidate.distanceKm, 1)} km · {round(candidate.bikeMinutes, 1)} min</span>
                </>
              )}
            />
          </Section>

          <Section title="Stations in circle">
            <EntityList
              emptyState="No S/U stations are currently inside this custom area."
              items={summary.insideStations.slice(0, 6)}
              renderItem={(station) => (
                <>
                  <strong>{station.item.name}</strong>
                  <span>{station.item.type} · {round(station.distanceKm, 1)} km</span>
                </>
              )}
            />
          </Section>

          <Section title="Counters in circle">
            <EntityList
              emptyState="No permanent bike counters are currently inside this custom area."
              items={summary.insideCounters.slice(0, 6)}
              renderItem={(counter) => (
                <>
                  <strong>{counter.item.name}</strong>
                  <span>
                    {getCounterMetricForTimeSlice(counter.item, timeSlice).toLocaleString()} in selected slice
                    {" · "}
                    {round(counter.distanceKm, 1)} km
                  </span>
                </>
              )}
            />
          </Section>
        </>
      )}
    </>
  );
}

function ZoneIntelCard({
  mode,
  score,
  accent,
  timeSlice,
}: {
  mode: Mode;
  score: ZoneScore;
  accent: string;
  timeSlice: TimeSlice;
}) {
  const zone = score.zone;
  const insights = buildZoneInsights(score, mode, timeSlice);
  const topStation = insights.nearbyStations[0]?.item.name ?? "No nearby station";

  return (
    <>
      <div className={css.headline}>{score.headline}</div>
      <div className={css.zoneSubtitle}>
        Selected zone: <strong>{zone.name}</strong> anchored on {topStation}
      </div>

      <div className={css.meters}>
        <Meter label="Demand" value={score.demand} color={accent} />
        <Meter label="Supply" value={score.supply} color="#8b5cf6" />
        <Meter label="Gap" value={score.gap} color="#d4a017" />
      </div>

      <div className={css.numbers}>
        <MetricCard label="cyclists / day" value={insights.dailyCyclists.toLocaleString()} />
        <MetricCard label="repair shops" value={zone.shopCount.toString()} />
        <MetricCard label="recruit targets" value={zone.candidateCount.toString()} />
        <MetricCard label="current partners" value={zone.partnerCount.toString()} />
        <MetricCard label="nearby stations" value={zone.nearbyStations.length.toString()} />
        <MetricCard label="repair proxy" value={`${score.repairDemandProxy}/100`} />
        <MetricCard
          label="bike theft /1k"
          value={score.districtContext.bikeTheftDensity != null ? score.districtContext.bikeTheftDensity.toFixed(1) : "—"}
        />
        <MetricCard
          label="nearest partner"
          value={
            insights.nearestPartnerMinutes != null
              ? `${round(insights.nearestPartnerMinutes, 0)} min`
              : "—"
          }
        />
      </div>

      <Section title="Why this zone">
        <ul className={css.signals}>
          {score.signals.map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      </Section>

      {score.districtContext.districtName && score.districtContext.socioeconomic ? (
        <Section title="District context">
          <div className={css.infoList}>
            <div className={css.infoRow}>
              <strong>District</strong>
              <span>{score.districtContext.districtName}</span>
            </div>
            <div className={css.infoRow}>
              <strong>Profile</strong>
              <span>{describeDistrictContext(score.districtContext)}</span>
            </div>
            <div className={css.infoRow}>
              <strong>Car-free households</strong>
              <span>{formatPercent(score.districtContext.socioeconomic.carFreeHouseholdsShare)}</span>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="Recruit targets">
        <EntityList
          emptyState="No independent bike shops are currently inside the zone reach."
          items={insights.recruitTargets}
          renderItem={(target) => (
            <>
              <strong>{target.item.name}</strong>
              <span>{round(target.distanceKm, 1)} km · {round(target.bikeMinutes, 1)} min</span>
            </>
          )}
        />
      </Section>

      <Section title="Current partner coverage">
        <EntityList
          emptyState="No Betteride partner is currently inside the zone reach."
          items={insights.currentPartners}
          renderItem={(partner) => (
            <>
              <strong>{partner.item.partnerName ?? partner.item.name}</strong>
              <span>{round(partner.distanceKm, 1)} km · {round(partner.bikeMinutes, 1)} min</span>
            </>
          )}
        />
      </Section>

      <Section title="Nearest stations">
        <EntityList
          emptyState="No S/U station is currently nearby."
          items={insights.nearbyStations}
          renderItem={(station) => (
            <>
              <strong>{station.item.name}</strong>
              <span>{station.item.type} · {round(station.distanceKm, 1)} km</span>
            </>
          )}
        />
      </Section>

      <Section title="Nearby counters">
        <EntityList
          emptyState="No permanent bike counters are currently nearby."
          items={insights.nearbyCounters}
          renderItem={(counter) => (
            <>
              <strong>{counter.item.name}</strong>
              <span>{counter.item.avgDaily.toLocaleString()} cyclists/day</span>
            </>
          )}
        />
      </Section>

      <Section title="Recommended action list">
        <ol className={css.actionList}>
          {insights.actionSteps.map((action) => (
            <li key={action.title} className={css.actionListItem}>
              <strong>{action.title}</strong>
              <span>{action.detail}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Primary move">
        <div
          className={`${css.actionCard} ${css.supportCard}`}
          style={{ borderLeft: `3px solid ${accent}` }}
        >
          {score.action}
        </div>
      </Section>

      <Section title="Track these KPIs">
        <div className={css.kpis}>
          {score.kpis.map((kpi) => (
            <span key={kpi} className={css.kpi}>
              {kpi}
            </span>
          ))}
        </div>
      </Section>
    </>
  );
}

function Meter({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={css.meter}>
      <div className={css.meterLabel}>{label}</div>
      <div className={css.meterValue} style={{ color }}>
        {round(value, 0)}
      </div>
      <div className={css.meterTrack}>
        <div
          className={css.meterFill}
          style={{ width: `${value}%`, background: color }}
        />
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={css.numCard}>
      <div className={css.numValue}>{value}</div>
      <div className={css.numLabel}>{label}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className={css.sectionLabel}>{title}</div>
      {children}
    </>
  );
}

function EntityList<T>({
  items,
  emptyState,
  renderItem,
}: {
  items: T[];
  emptyState: string;
  renderItem: (item: T) => ReactNode;
}) {
  if (items.length === 0) {
    return <div className={css.infoEmpty}>{emptyState}</div>;
  }

  return (
    <div className={css.infoList}>
      {items.map((item, index) => (
        <div className={css.infoRow} key={index}>
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}

function formatTimeSliceLabel(timeSlice: TimeSlice) {
  if (timeSlice === "weekday-peak") return "Peak";
  if (timeSlice === "weekday-offpeak") return "Off-peak";
  return "Weekend";
}

function formatConfidenceLabel(confidence: AreaAnalysisSummary["estimateConfidence"]) {
  if (confidence === "high") return "High";
  if (confidence === "medium") return "Medium";
  return "Low";
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value: number) {
  const percent = Math.round(value * 100);
  if (percent > 0) return `+${percent}%`;
  if (percent < 0) return `${percent}%`;
  return "0%";
}
