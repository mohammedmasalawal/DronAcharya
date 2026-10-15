import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import type { ScenarioSpec } from '../schema';
import { FOG_FAR_M, GROUND_COLOR, LIGHT_LEVEL, SKY_COLOR } from './palette';

export interface SceneContact {
  x: number;
  y: number;
  alt: number;
  color: string;
  opacity: number;
}

interface SceneProps {
  spec: ScenarioSpec;
  ids: string[];
  read: (id: string) => SceneContact | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const MARKER_RADIUS_M = 110;
const HIT_RADIUS_M = 260;

function Contact({
  id,
  read,
  selected,
  onSelect,
}: {
  id: string;
  read: SceneProps['read'];
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const stem = useRef<Mesh>(null);

  useFrame(() => {
    const contact = read(id);
    if (!group.current || !body.current || !stem.current) return;
    group.current.visible = contact !== undefined;
    if (!contact) return;

    group.current.position.set(contact.x, contact.alt, -contact.y);
    const stemHeight = Math.max(contact.alt, 1);
    stem.current.scale.y = stemHeight;
    stem.current.position.y = -stemHeight / 2;

    const material = body.current.material as MeshStandardMaterial;
    material.color.set(contact.color);
    material.emissive.set(contact.color);
    material.opacity = contact.opacity;
  });

  return (
    <group ref={group}>
      <mesh ref={body}>
        <sphereGeometry args={[MARKER_RADIUS_M, 16, 12]} />
        <meshStandardMaterial transparent emissiveIntensity={0.6} />
      </mesh>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(id);
        }}
      >
        <sphereGeometry args={[HIT_RADIUS_M, 8, 6]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh ref={stem}>
        <boxGeometry args={[12, 1, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[MARKER_RADIUS_M * 1.6, MARKER_RADIUS_M * 2, 32]} />
          <meshBasicMaterial color="#ffffff" side={2} />
        </mesh>
      )}
    </group>
  );
}

export function Scene({ spec, ids, read, selectedId, onSelect }: SceneProps) {
  const sky = SKY_COLOR[spec.timeOfDay];
  const light = LIGHT_LEVEL[spec.timeOfDay];
  const fogFar = FOG_FAR_M[spec.weather];

  return (
    <Canvas camera={{ position: [0, 5600, 6400], fov: 45, near: 10, far: 60000 }}>
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, fogFar * 0.15, fogFar]} />
      <ambientLight intensity={0.5 * light + 0.15} />
      <directionalLight position={[3000, 6000, 2000]} intensity={1.2 * light} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]}>
        <planeGeometry args={[40000, 40000]} />
        <meshStandardMaterial color={GROUND_COLOR[spec.mapType]} />
      </mesh>
      <gridHelper args={[16000, 32, '#4b5563', '#2f3744']} />

      {spec.assets.map((asset) => (
        <mesh key={asset.id} position={[asset.x, 40, -asset.y]}>
          <boxGeometry args={[110, 80, 110]} />
          <meshStandardMaterial color="#2f80ed" emissive="#2f80ed" emissiveIntensity={0.4} />
        </mesh>
      ))}

      {spec.effectors.map((effector) => (
        <mesh key={effector.type} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1, 0]}>
          <ringGeometry args={[effector.rangeM - 8, effector.rangeM + 8, 96]} />
          <meshBasicMaterial color="#5eead4" transparent opacity={0.45} side={2} />
        </mesh>
      ))}

      {ids.map((id) => (
        <Contact key={id} id={id} read={read} selected={id === selectedId} onSelect={onSelect} />
      ))}

      <OrbitControls maxPolarAngle={Math.PI / 2.05} maxDistance={20000} />
    </Canvas>
  );
}
