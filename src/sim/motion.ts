import type { ThreatState } from './types';

export const ARRIVE_RADIUS_M = 30;
const ORBIT_RADIUS_M = 700;
const DIVE_AFTER_ORBIT_SEC = 45;
const WEAVE_AMPLITUDE_RAD = 0.6;
const WEAVE_RATE_RAD_PER_SEC = 0.8;
const MASKED_ALTITUDE_M = 30;
const MIN_ALTITUDE_FRACTION = 0.05;

type Vec = [number, number];

function unit(x: number, y: number): Vec {
  const length = Math.hypot(x, y);
  return length === 0 ? [0, 0] : [x / length, y / length];
}

export function distanceToTargetM(threat: ThreatState): number {
  return Math.hypot(threat.targetX - threat.x, threat.targetY - threat.y);
}

function approach(threat: ThreatState): Vec {
  return unit(threat.targetX - threat.x, threat.targetY - threat.y);
}

function weave(threat: ThreatState, now: number): Vec {
  const [dx, dy] = approach(threat);
  const angle = Math.sin(now * WEAVE_RATE_RAD_PER_SEC + threat.phase) * WEAVE_AMPLITUDE_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

function orbit(threat: ThreatState): Vec {
  const rx = threat.x - threat.targetX;
  const ry = threat.y - threat.targetY;
  const dist = Math.max(Math.hypot(rx, ry), 1);
  const correction = Math.max(-0.5, Math.min(0.5, (ORBIT_RADIUS_M - dist) / ORBIT_RADIUS_M));
  return unit(-ry / dist + (rx / dist) * correction, rx / dist + (ry / dist) * correction);
}

function loiter(threat: ThreatState, now: number): Vec {
  if (threat.orbitStartSec === null) {
    if (distanceToTargetM(threat) > ORBIT_RADIUS_M) return approach(threat);
    threat.orbitStartSec = now;
  }
  return now - threat.orbitStartSec < DIVE_AFTER_ORBIT_SEC ? orbit(threat) : approach(threat);
}

function direction(threat: ThreatState, now: number): Vec {
  const { hostile, behavior } = threat.spec;

  if (!hostile) {
    return behavior === 'loiter' ? orbit(threat) : unit(threat.vx, threat.vy);
  }

  switch (behavior) {
    case 'loiter':
      return loiter(threat, now);
    case 'evasive':
      return weave(threat, now);
    default:
      return approach(threat);
  }
}

function altitude(threat: ThreatState): number {
  const { hostile, behavior, altM } = threat.spec;
  if (!hostile) return altM;

  const base = behavior === 'terrain_mask' ? Math.min(altM, MASKED_ALTITUDE_M) : altM;
  const fraction = distanceToTargetM(threat) / Math.max(threat.startDistM, 1);
  return base * Math.max(MIN_ALTITUDE_FRACTION, Math.min(1, fraction));
}

export function advanceThreat(threat: ThreatState, now: number, dt: number): void {
  const [dx, dy] = direction(threat, now);
  threat.x += dx * threat.spec.speedMps * dt;
  threat.y += dy * threat.spec.speedMps * dt;
  threat.alt = altitude(threat);
}
