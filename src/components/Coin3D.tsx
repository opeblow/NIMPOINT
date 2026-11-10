'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Float, Lightformer } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

/** The NimPoint pin: round head tapering to a point, with a hole for the Naira bars. */
function pinShape() {
  const cy = 0.14;
  const r = 0.36;
  const tip = new THREE.Vector2(0, -0.6);
  const a = Math.asin(r / (cy - tip.y));
  const t1 = -Math.PI / 2 + (Math.PI / 2 - a);
  const t2 = -Math.PI / 2 - (Math.PI / 2 - a) + Math.PI * 2;
  const s = new THREE.Shape();
  s.moveTo(tip.x, tip.y);
  s.lineTo(Math.cos(t1) * r, cy + Math.sin(t1) * r);
  s.absarc(0, cy, r, t1, t2, false);
  s.lineTo(tip.x, tip.y);
  const hole = new THREE.Path();
  hole.absarc(0, cy, 0.19, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

function Coin({ spin }: { spin: boolean }) {
  const group = useRef<THREE.Group>(null);

  const { pin } = useMemo(() => {
    const pin = new THREE.ExtrudeGeometry(pinShape(), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 3, curveSegments: 48 });
    pin.translate(0, -0.02, 0);
    return { pin };
  }, []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -state.pointer.y * 0.35, 3, dt);
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, state.pointer.x * 0.12, 3, dt);
    g.rotation.y += dt * (spin ? 2.4 : 0.45);
  });

  return (
    <group ref={group}>
      {/* coin body */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1, 1, 0.2, 96]} />
        <meshPhysicalMaterial color="#e9b213" metalness={1} roughness={0.26} clearcoat={0.6} clearcoatRoughness={0.25} />
      </mesh>
      {[1, -1].map((side) => (
        <group key={side} position={[0, 0, side * 0.1]} rotation={[0, side === 1 ? 0 : Math.PI, 0]}>
          {/* raised rim */}
          <mesh>
            <torusGeometry args={[0.93, 0.045, 16, 96]} />
            <meshPhysicalMaterial color="#f2c63a" metalness={1} roughness={0.22} />
          </mesh>
          {/* recessed field */}
          <mesh position={[0, 0, 0.001]}>
            <circleGeometry args={[0.89, 96]} />
            <meshPhysicalMaterial color="#c99200" metalness={1} roughness={0.42} />
          </mesh>
          {/* embossed pin + naira bars */}
          <mesh geometry={pin} position={[0, 0, 0.004]}>
            <meshPhysicalMaterial color="#f5cf4a" metalness={1} roughness={0.2} clearcoat={0.8} />
          </mesh>
          {[0.055, -0.035].map((y) => (
            <mesh key={y} position={[0, 0.12 + y, 0.03]}>
              <boxGeometry args={[0.3, 0.035, 0.04]} />
              <meshPhysicalMaterial color="#f5cf4a" metalness={1} roughness={0.2} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

export default function Coin3D({ spin = false }: { spin?: boolean }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 4.1], fov: 34 }} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 4, 5]} intensity={1.2} />
      <Float speed={1.6} rotationIntensity={0.15} floatIntensity={0.6}>
        <Coin spin={spin} />
      </Float>
      <ContactShadows position={[0, -1.35, 0]} opacity={0.32} scale={5} blur={2.6} far={2} color="#5b4300" />
      {/* Studio lighting built in code: no HDR download inside the webview. */}
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[0, 3, 2]} scale={[6, 1.2, 1]} color="#fff6dc" />
        <Lightformer form="rect" intensity={1.6} position={[-4, 0, 1]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.2} position={[4, -1, 1]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} color="#ffe2a0" />
        <Lightformer form="circle" intensity={0.8} position={[0, -3, 3]} scale={3} color="#f3efe6" />
      </Environment>
    </Canvas>
  );
}
