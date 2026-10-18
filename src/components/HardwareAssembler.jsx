import React, { useCallback, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import HardwarePart from './HardwarePart';

/**
 * HardwareAssembler
 * 
 * Ultra-optimized:
 * - NO scene.clone(true)
 * - NO material mutation or scene.traverse inside selection events
 * - Purely uses the cached useGLTF scene
 */

const CATEGORY_KEYWORDS = [
  { category: 'Memoria RAM',             keys: ['ram', 'dimm', 'memory'] },
  { category: 'Tarjeta Gráfica',         keys: ['gpu', 'graphic', 'video', 'rtx', 'gtx', 'radeon', 'pcie'] },
  { category: 'Procesador/Refrigeración', keys: ['cpu', 'cooler', 'fan', 'heatsink', 'pump', 'cuper', 'socket'] },
  { category: 'Placa Base',              keys: ['board', 'mother', 'main', 'motherboard'] },
  { category: 'Almacenamiento',          keys: ['ssd', 'hdd', 'disk', 'nvme', 'storage', 'sata', 'm.2'] },
  { category: 'Fuente de Poder',         keys: ['power', 'psu', 'supply', 'cable', 'wire'] },
];

function detectCategory(object) {
  let current = object;
  while (current) {
    const name = (current.name || '').toLowerCase();
    const matName = (current.material?.name || '').toLowerCase();
    const combined = `${name} ${matName}`;

    for (const entry of CATEGORY_KEYWORDS) {
      if (entry.keys.some((k) => combined.includes(k))) {
        return { category: entry.category, nodeName: current.name || object.name || 'node' };
      }
    }
    current = current.parent;
  }
  return { category: 'Placa Base', nodeName: object.name || 'node' };
}

export default function HardwareAssembler({ profile, telemetry, onSelect, explodedView }) {
  // Use the cached scene immutably.
  const { scene } = useGLTF('/models/pc-opt.glb');

  // We do one initial setup to cache original positions for the exploded view.
  // This runs once and never modifies materials or clones the scene.
  useMemo(() => {
    scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        if (!child.userData._origPos) {
          child.userData._origPos = child.position.clone();
          const dir = child.position.clone().normalize();
          if (dir.lengthSq() === 0) dir.set(0, 1, 0);
          child.userData._explodedPos = child.position.clone().add(dir.multiplyScalar(4));
        }
      }
    });
  }, [scene]);

  // Pure WebGL animation hook, bypassing React renders
  useFrame((_, delta) => {
    scene.traverse((child) => {
      if (child.isMesh && child.userData._origPos) {
        const target = explodedView ? child.userData._explodedPos : child.userData._origPos;
        child.position.lerp(target, delta * 6);
      }
    });
  });

  const handlePointerDown = useCallback((e) => {
    e.stopPropagation();
    const { category, nodeName } = detectCategory(e.object);
    const diag = telemetry?.components?.[category] || {};
    onSelect({ category, nodeName, data: diag });
  }, [onSelect, telemetry]);

  return (
    <group>
      <primitive
        object={scene}
        onPointerDown={handlePointerDown}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'auto'; }}
      />

      {/* Archetype overlays if any */}
      {profile?.parts?.ram?.map((slot, i) => (
        <HardwarePart
          key={`ram-${i}`}
          file={slot.file}
          position={explodedView ? slot.explodedOffset : slot.position}
          partData={{ category: 'Memoria RAM', nodeName: `DIMM_${i}`, data: slot.meta }}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

useGLTF.preload('/models/pc-opt.glb');
