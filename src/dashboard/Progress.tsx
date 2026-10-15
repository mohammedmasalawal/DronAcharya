import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SkillProfile } from '../engine/adaptive';
import type { SessionRecord, TraineeRecord, UnitRecord } from '../store/records';
import {
  COMPETENCY_KEYS,
  chronological,
  competencyTrend,
  confusionMatrix,
  difficultyTrend,
  isExamSession,
  lowestRecentCompetency,
  meanDifficulty,
  noveltyTrend,
  reactionByCondition,
  weakestByElo,
} from './data';
import { loadTraineeView } from './load';
import {
  COMPETENCY_COLOR,
  COMPETENCY_LABEL,
  CLASS_LABEL,
  Card,
  DemoBanner,
  Link,
  Message,
  Shell,
  fixed,
  sessionUrl,
  useLoad,
} from './ui';

interface MarkerProps {
  cx?: number;
  cy?: number;
}

function TriangleMarker({ cx, cy }: MarkerProps) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <polygon points={`${cx},${cy - 9} ${cx - 8},${cy + 6} ${cx + 8},${cy + 6}`} fill="#ff5d6c" />
  );
}

function DiamondMarker({ cx, cy }: MarkerProps) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <polygon
      points={`${cx},${cy - 9} ${cx + 8},${cy} ${cx},${cy + 9} ${cx - 8},${cy}`}
      fill="#ffc857"
      stroke="#0b1220"
    />
  );
}

function RatingMeter({ rating }: { rating: number }) {
  const share = Math.max(0, Math.min(1, (rating - 800) / 600));
  return (
    <div className="meter">
      <span style={{ width: `${share * 100}%` }} />
    </div>
  );
}

function LevelMeter({ level }: { level: number }) {
  return (
    <div className="meter meter-level">
      <span style={{ width: `${Math.max(0, Math.min(1, level)) * 100}%` }} />
    </div>
  );
}

export function ProgressView({
  trainee,
  unit,
  sessions,
  profile,
}: {
  trainee: TraineeRecord;
  unit: UnitRecord | undefined;
  sessions: SessionRecord[];
  profile: SkillProfile | undefined;
}) {
  const ordered = chronological(sessions);
  const competencies = competencyTrend(sessions);
  const difficulty = difficultyTrend(sessions);
  const novelty = noveltyTrend(sessions);
  const matrix = confusionMatrix(sessions);
  const reaction = reactionByCondition(sessions).map((row) => ({
    group: row.group,
    meanSec: row.meanSec === null ? 0 : Number(row.meanSec.toFixed(1)),
    count: row.count,
  }));
  const weakest = weakestByElo(profile);
  const lowest = lowestRecentCompetency(sessions);

  const levelRows = ordered.map((session, index) => {
    const exam = isExamSession(session);
    const trendPoint = difficulty.trend.find((point) => point.n === index + 1);
    const noveltyPoint = novelty.trend.find((point) => point.n === index + 1);
    return {
      n: index + 1,
      difficulty: trendPoint ? Number(trendPoint.value.toFixed(3)) : null,
      novelty: noveltyPoint ? Number(noveltyPoint.value.toFixed(3)) : null,
      exam: exam ? Number(meanDifficulty(session.spec).toFixed(3)) : null,
    };
  });

  const totalRows = ordered.map((session, index) => {
    const total = Number(session.report.total.toFixed(1));
    return {
      n: index + 1,
      total,
      critical: session.report.critical.length > 0 ? total + 6 : null,
      exam: isExamSession(session) ? total + 6 : null,
      fill: isExamSession(session) ? '#8896b3' : '#5aa9ff',
    };
  });

  return (
    <>
      <section className="dash-hero dash-hero-compact">
        <div className="dash-hero-body">
          <p className="dash-hero-line">
            <strong>{trainee.name}</strong> · {unit ? unit.name : trainee.unitId} ·{' '}
            {sessions.length} sessions
          </p>
          <p className="dash-meta">
            {unit && (
              <>
                <Link to={sessionUrl('unit', unit.id)}>Open unit view</Link>
              </>
            )}
          </p>
        </div>
        <div className="dash-callouts">
          {weakest && (
            <div className="callout callout-weak">
              <span>Weakest by Elo rating</span>
              <b>{COMPETENCY_LABEL[weakest]}</b>
              <em>{profile ? fixed(profile.ratings[weakest], 0) : ''}</em>
            </div>
          )}
          {lowest && (
            <div className="callout callout-low">
              <span>Lowest recent score (last 3 sessions)</span>
              <b>{COMPETENCY_LABEL[lowest.key]}</b>
              <em>{fixed(lowest.value, 0)}</em>
            </div>
          )}
        </div>
      </section>

      <Card title="Competency trend (exam sessions excluded)" wide>
        <div className="dash-chart">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={competencies} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="n" type="number" domain={[1, 'dataMax']} allowDecimals={false} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              {COMPETENCY_KEYS.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={COMPETENCY_LABEL[key] + (key === weakest ? ' (weakest)' : '')}
                  stroke={COMPETENCY_COLOR[key]}
                  strokeWidth={key === weakest ? 5 : 2}
                  dot={{ r: key === weakest ? 4 : 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="dash-grid">
        <Card title="Skill estimate (Elo) and controller level">
          {profile ? (
            <table className="dash-table dash-ratings">
              <thead>
                <tr>
                  <th>Competency</th>
                  <th>Elo</th>
                  <th />
                  <th>Level</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {COMPETENCY_KEYS.map((key) => (
                  <tr key={key} className={key === weakest ? 'row-weak' : ''}>
                    <td>
                      <span className="swatch" style={{ background: COMPETENCY_COLOR[key] }} />
                      {COMPETENCY_LABEL[key]}
                    </td>
                    <td className="num">{fixed(profile.ratings[key], 0)}</td>
                    <td>
                      <RatingMeter rating={profile.ratings[key]} />
                    </td>
                    <td className="num">{fixed(profile.levels[key], 2)}</td>
                    <td>
                      <LevelMeter level={profile.levels[key]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Message>No skill profile yet.</Message>
          )}
        </Card>

        <Card title="Difficulty and novelty">
          <div className="dash-chart">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={levelRows} margin={{ left: 0, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="n" type="number" domain={[1, 'dataMax']} allowDecimals={false} />
                <YAxis domain={[0, 1]} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="difficulty"
                  name="Difficulty"
                  stroke="#ff7a59"
                  strokeWidth={3}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="novelty"
                  name="Novelty"
                  stroke="#4dd0e1"
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  dataKey="exam"
                  name="Exam (difficulty)"
                  stroke="none"
                  dot={<DiamondMarker />}
                  activeDot={false}
                  isAnimationActive={false}
                  legendType="diamond"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Total score per session" wide>
        <div className="dash-chart">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={totalRows} margin={{ left: 0, right: 16, top: 16 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="n" />
              <YAxis domain={[0, 110]} ticks={[0, 25, 50, 75, 100]} />
              <Tooltip />
              <Bar dataKey="total" name="Total" isAnimationActive={false} shape={<TotalBar />} />
              <Line
                dataKey="critical"
                name="Critical fail (score capped)"
                stroke="none"
                dot={<TriangleMarker />}
                activeDot={false}
                isAnimationActive={false}
                legendType="triangle"
              />
              <Line
                dataKey="exam"
                name="Exam"
                stroke="none"
                dot={<DiamondMarker />}
                activeDot={false}
                isAnimationActive={false}
                legendType="diamond"
              />
              <Legend />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="muted small">
          ▲ marks a session with a critical fail: the cap limits the total, so it is not a drop in
          skill. ◆ marks the unit exam, which is also left out of every trend line.
        </p>
      </Card>

      <div className="dash-grid">
        <Card title="Classification confusion (true class rows, chosen class columns)">
          {matrix.total === 0 ? (
            <Message>No scored contacts yet.</Message>
          ) : (
            <div className="dash-scroll">
              <table className="dash-table dash-confusion">
                <thead>
                  <tr>
                    <th>True \ chosen</th>
                    {matrix.columns.map((column) => (
                      <th key={column}>{CLASS_LABEL[column]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows
                    .filter((row) => matrix.columns.some((c) => (matrix.counts[row]?.[c] ?? 0) > 0))
                    .map((row) => {
                      const cells = matrix.counts[row]!;
                      const rowTotal = matrix.columns.reduce((sum, c) => sum + (cells[c] ?? 0), 0);
                      return (
                        <tr key={row}>
                          <th>{CLASS_LABEL[row]}</th>
                          {matrix.columns.map((column) => {
                            const count = cells[column] ?? 0;
                            const share = rowTotal > 0 ? count / rowTotal : 0;
                            const correct = column === row;
                            const colour = correct ? '61, 220, 151' : '255, 93, 108';
                            return (
                              <td
                                key={column}
                                className="num"
                                style={{
                                  background:
                                    count > 0
                                      ? `rgba(${colour}, ${0.15 + share * 0.6})`
                                      : undefined,
                                }}
                              >
                                {count > 0 ? count : ''}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Mean reaction time by condition (seconds)">
          <div className="dash-chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={reaction} margin={{ left: 0, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="group" />
                <YAxis />
                <Tooltip />
                <Bar
                  dataKey="meanSec"
                  name="Mean reaction (s)"
                  fill="#5aa9ff"
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="muted small">
            Groups overlap: a night session in fog with a failed sensor counts in night, fog and
            degraded. Empty groups show as zero.
          </p>
        </Card>
      </div>

      <Card title="Sessions" wide>
        <table className="dash-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Session</th>
              <th>Conditions</th>
              <th>Difficulty</th>
              <th>Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordered.map((session, index) => (
              <tr key={session.id}>
                <td className="num">{index + 1}</td>
                <td>
                  {session.scenarioId}
                  {isExamSession(session) && <span className="badge badge-exam">Exam</span>}
                  {session.report.critical.length > 0 && (
                    <span className="badge badge-critical">Critical fail</span>
                  )}
                </td>
                <td>
                  {session.spec.mapType} · {session.spec.timeOfDay} · {session.spec.weather}
                </td>
                <td className="num">{fixed(meanDifficulty(session.spec), 2)}</td>
                <td className="num">{fixed(session.report.total, 0)}</td>
                <td className="no-print">
                  <Link to={sessionUrl('debrief', session.id)}>Debrief</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { fill?: string };
}

function TotalBar({ x, y, width, height, payload }: BarShapeProps) {
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return null;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={Math.max(0, height)}
      rx={3}
      fill={payload?.fill ?? '#5aa9ff'}
    />
  );
}

export function Progress({ params }: { params: Record<string, string> }) {
  const traineeId = params.traineeId ?? '';
  const state = useLoad(() => loadTraineeView(traineeId), [traineeId]);
  const view = state.data;

  return (
    <Shell
      title="Trainee progress"
      subtitle="Competency, difficulty and error patterns across repeated sessions"
      banner={view ? <DemoBanner ids={[view.trainee.id]} onReset={state.reload} /> : undefined}
    >
      {state.loading && !view && <Message>Loading trainee...</Message>}
      {state.error && <Message>{state.error}</Message>}
      {!state.loading && !state.error && !view && (
        <Message>
          No trainee found for {traineeId}. <Link to="/review">Back to review</Link>
        </Message>
      )}
      {view && (
        <ProgressView
          trainee={view.trainee}
          unit={view.unit}
          sessions={view.sessions}
          profile={view.profile}
        />
      )}
    </Shell>
  );
}
