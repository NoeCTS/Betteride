import type { ReactNode } from "react";

import type {
  AreaAnalysisCircle,
  AreaAnalysisSummary,
  Mode,
  TimeSlice,
  ZoneScore,
} from "@/lib/types";
import { getModeAccent } from "@/lib/types";
import { round } from "@/lib/geo";
import { buildZoneInsights } from "@/lib/zone-insights";
import { buildAreaActionSteps, getCounterMetricForTimeSlice } from "@/lib/area-analysis";
import css from "./ground-signal.module.css";

interface IntelPanelProps {
  mode: Mode;
  timeSlice: TimeSlice;
  scores: ZoneScore[];
  analysisEnabled: boolean;
  placementMode: boolean;
  analysisCircle: AreaAnalysisCircle;
  analysisSummary: AreaAnalysisSummary | null;
  selectedZoneId: string | null;
  onSelectZone: (id: string) => void;
  onClearArea: () => void;
}

export default function IntelPanel({
  mode,
  timeSlice,
  scores,
  analysisEnabled,
  placementMode,
  analysisCircle,
  analysisSummary,
  selectedZoneId,
  onSelectZone,
  onClearArea,
}: IntelPanelProps) {
  const accent = getModeAccent(mode);
  const top10 = scores.slice(0, 10);
  const selected = scores.find((score) => score.zone.id === selectedZoneId) ?? null;
  const showAreaAnalysis = analysisEnabled || Boolean(analysisSummary);

  return (
    <div className={css.intelPanel}>
      <div className={css.intelHeader}>
        <div className={css.intelTitle}>Top opportunity zones</div>
        <label className={css.zonePickerLabel} htmlFor="zone-picker">
          Selected zone
        </label>
        <select
          className={css.zonePicker}
          id="zone-picker"
          onChange={(event) => onSelectZone(event.target.value)}
          value={selected?.zone.id ?? scores[0]?.zone.id ?? ""}
        >
          {scores.map((score, index) => (
            <option key={score.zone.id} value={score.zone.id}>
              {index + 1}. {score.zone.name}
            </option>
          ))}
        </select>
      </div>

      <div className={css.zoneList}>
        {top10.map((score, index) => (
          <div
            key={score.zone.id}
            className={`${css.zoneRow} ${selectedZoneId === score.zone.id ? css.zoneRowActive : ""}`}
            onClick={() => onSelectZone(score.zone.id)}
          >
            <span className={css.zoneRank}>{index + 1}</span>
            <div>
              <div className={css.zoneName}>{score.zone.name}</div>
              <div
                className={css.zoneBar}
                style={{
                  width: `${score.opportunity}%`,
                  background: accent,
                  opacity: selectedZoneId === score.zone.id ? 1 : 0.5,
                }}
              />
            </div>
            <span className={css.zoneScore} style={{ color: accent }}>
              {round(score.opportunity, 0)}
            </span>
          </div>
        ))}
      </div>

      <div className={css.intelCard}>
        {showAreaAnalysis ? (
          <>
            <AreaIntelCard
              analysisCircle={analysisCircle}
              placementMode={placementMode}
              summary={analysisSummary}
              timeSlice={timeSlice}
              onClearArea={onClearArea}
            />
            <div className={css.intelDivider} />
          </>
        ) : null}

        {!selected ? (
          <div className={css.intelEmpty}>
            Click a zone on the map or in the list above to see intelligence
          </div>
        ) : (
          <ZoneIntelCard mode={mode} score={selected} accent={accent} timeSlice={timeSlice} />
        )}
      </div>
    </div>
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
          </div>

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
        <Meter label="Supply" value={score.supply} color="#5e6a62" />
        <Meter label="Gap" value={score.gap} color="#b74d35" />
      </div>

      <div className={css.numbers}>
        <MetricCard label="cyclists / day" value={insights.dailyCyclists.toLocaleString()} />
        <MetricCard label="repair shops" value={zone.shopCount.toString()} />
        <MetricCard label="recruit targets" value={zone.candidateCount.toString()} />
        <MetricCard label="current partners" value={zone.partnerCount.toString()} />
        <MetricCard label="nearby stations" value={zone.nearbyStations.length.toString()} />
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
          className={css.actionCard}
          style={{ background: accent + "14", borderLeft: `3px solid ${accent}` }}
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
