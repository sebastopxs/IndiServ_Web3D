import React, { useCallback, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';

/**
 * HardwarePart
 * Ultra-optimized: Uses immutable primitive object. No clone, no traverse.
 */
export default function HardwarePart({ file, partData, onSelect, position = [0, 0, 0] }) {
  if (!file) return null;

  return (
    <group position={position}>
      <React.Suspense fallback={null}>
        <PartMesh file={file} partData={partData} onSelect={onSelect} />
      </React.Suspense>
    </group>
  );
}

function PartMesh({ file, partData, onSelect }) {
  let gltf = null;
  try {
    gltf = useGLTF(file);
  } catch (e) {
    console.warn(`[HardwarePart] Asset not found: ${file}`);
    return null;
  }

  // Set shadows once on mount
  useMemo(() => {
    if (gltf?.scene) {
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, [gltf]);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    if (onSelect) onSelect(partData);
  }, [onSelect, partData]);

  if (!gltf?.scene) return null;

  return (
    <primitive
      object={gltf.scene}
      onPointerDown={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'auto'; }}
    />
  );
}
