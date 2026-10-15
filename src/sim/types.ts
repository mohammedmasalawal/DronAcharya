import type {
  EffectorType,
  ScenarioSpec,
  SensorType,
  SessionEvent,
  Threat,
  ThreatClass,
} from '../schema';

export type SimInput =
  | { type: 'detect'; threatId: string }
  | { type: 'classify'; threatId: string; cls: ThreatClass; confidence: number }
  | { type: 'rank'; order: string[] }
  | { type: 'engage'; threatId: string; effector: EffectorType };

export type ThreatStatus = 'pending' | 'active' | 'neutralised' | 'leaked' | 'exited' | 'ignored';

export interface PendingEffect {
  effector: EffectorType;
  resolveAt: number;
}

export interface ThreatState {
  id: string;
  spec: Threat;
  status: ThreatStatus;
  x: number;
  y: number;
  alt: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  startDistM: number;
  phase: number;
  orbitStartSec: number | null;
  assistantSuggestion: ThreatClass;
  visibleBy: SensorType[];
  everObservable: boolean;
  detectedAt: number | null;
  classifiedAs: ThreatClass | null;
  pending: PendingEffect | null;
}

export interface EffectorState {
  type: EffectorType;
  rangeM: number;
  ammo: number;
}

export interface Rejection {
  t: number;
  input: SimInput;
  reason: string;
}

export interface World {
  spec: ScenarioSpec;
  tick: number;
  t: number;
  done: boolean;
  events: SessionEvent[];
  threats: ThreatState[];
  effectors: EffectorState[];
  rejected: Rejection[];
}

export interface Observation {
  threatId: string;
  x: number;
  y: number;
  altM: number;
  rangeM: number;
  bearingDeg: number;
  speedMps: number;
  sensors: SensorType[];
  detected: boolean;
  classifiedAs: ThreatClass | null;
  assistantSuggestion: ThreatClass | null;
  engageable: EffectorType[];
}

export interface GroundTruth {
  threatId: string;
  cls: ThreatClass;
  hostile: boolean;
  behavior: Threat['behavior'];
  swarmId?: string;
  status: ThreatStatus;
  x: number;
  y: number;
  altM: number;
  speedMps: number;
  visible: boolean;
  detected: boolean;
  classifiedAs: ThreatClass | null;
}
