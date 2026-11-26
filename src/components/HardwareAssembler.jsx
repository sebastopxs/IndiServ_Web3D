import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';

/**
 * HardwareAssembler
 *
 * Ultra-optimized:
 * - NO scene.clone(true)
 * - NO material mutation or scene.traverse inside selection events
 * - Purely uses the cached useGLTF scene
 */

const DESKTOP_MODEL_PATH = '/models/pc-opt.glb';
const LAPTOP_MODEL_PATH = '/models/laptop-opt.glb';
const PHONE_MODEL_PATH = '/models/phone-opt.glb';

const CATEGORY_KEYWORDS = [
  { category: 'Memoria RAM',             keys: ['ram', 'dimm', 'sodimm', 'lpddr', 'memory'] },
  { category: 'Tarjeta Gráfica',         keys: ['gpu', 'graphic', 'video', 'rtx', 'gtx', 'radeon', 'pcie', 'dgpu', 'adreno', 'mali', 'camera'] },
  { category: 'Procesador/Refrigeración', keys: ['cpu', 'soc', 'cooler', 'fan', 'heatsink', 'heatpipe', 'vapor', 'pump', 'cuper', 'socket'] },
  { category: 'Placa Base',              keys: ['board', 'mother', 'main', 'motherboard', 'keyboard', 'trackpad', 'hinge', 'screen', 'display', 'oled', 'frame', 'chassis', 'glass'] },
  { category: 'Almacenamiento',          keys: ['ssd', 'hdd', 'disk', 'nvme', 'ufs', 'storage', 'sata', 'm.2'] },
  { category: 'Fuente de Poder',         keys: ['power', 'psu', 'supply', 'cable', 'wire', 'battery', 'bateria', 'adapter', 'usb'] },
];

export function resolveModelPath(profile, telemetry) {
  if (profile?.model_file) {
    return profile.model_file;
  }
  const rawTipo = (
    profile?.tipo_equipo ||
    telemetry?.specs_json?.tipo_equipo ||
    telemetry?.tipo_equipo ||
    'desktop'
  )
    .toString()
    .trim()
    .toLowerCase();
  if (rawTipo === 'phone' || rawTipo === 'smartphone' || rawTipo === 'mobile' || rawTipo === 'tablet') {
    return PHONE_MODEL_PATH;
  }
  return rawTipo === 'laptop' ? LAPTOP_MODEL_PATH : DESKTOP_MODEL_PATH;
}

class ModelFallbackBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failedPath: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err) {
    console.warn(
      `[HardwareAssembler] No se pudo cargar '${this.props.modelPath}', aplicando fallback seguro a '${DESKTOP_MODEL_PATH}'.`,
      err?.message || err
    );
    this.setState({ failedPath: this.props.modelPath });
  }

  render() {
    if (this.state.hasError || this.state.failedPath === this.props.modelPath) {
      if (this.props.modelPath !== DESKTOP_MODEL_PATH) {
        return this.props.renderFallback(DESKTOP_MODEL_PATH);
      }
      throw new Error(`No se pudo cargar el modelo base ${DESKTOP_MODEL_PATH}`);
    }
    return this.props.children;
  }
}

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

function SceneMesh({ modelPath, profile, telemetry, onSelect, explodedView }) {
  const { scene } = useGLTF(modelPath);
  const settledRef = useRef(false);

  const animatableMeshes = useMemo(() => {
    const meshes = [];
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
        meshes.push(child);
      }
    });
    return meshes;
  }, [scene]);

  useEffect(() => {
    settledRef.current = false;
  }, [explodedView, animatableMeshes]);

  useFrame((_, delta) => {
    if (settledRef.current) return;
    const alpha = Math.min(1, delta * 6);
    let moving = false;
    for (let i = 0; i < animatableMeshes.length; i++) {
      const child = animatableMeshes[i];
      const target = explodedView ? child.userData._explodedPos : child.userData._origPos;
      if (child.position.distanceToSquared(target) > 0.0001) {
        child.position.lerp(target, alpha);
        moving = true;
      } else {
        child.position.copy(target);
      }
    }
    if (!moving) settledRef.current = true;
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
    </group>
  );
}

export default function HardwareAssembler({ profile, telemetry, onSelect, explodedView }) {
  const targetModelPath = resolveModelPath(profile, telemetry);

  return (
    <ModelFallbackBoundary
      key={targetModelPath}
      modelPath={targetModelPath}
      renderFallback={(fallbackPath) => (
        <SceneMesh
          modelPath={fallbackPath}
          profile={profile}
          telemetry={telemetry}
          onSelect={onSelect}
          explodedView={explodedView}
        />
      )}
    >
      <SceneMesh
        modelPath={targetModelPath}
        profile={profile}
        telemetry={telemetry}
        onSelect={onSelect}
        explodedView={explodedView}
      />
    </ModelFallbackBoundary>
  );
}

try {
  if (Capacitor.isNativePlatform()) {
    useGLTF.preload(PHONE_MODEL_PATH);
  } else {
    useGLTF.preload(DESKTOP_MODEL_PATH);
  }
} catch {
  useGLTF.preload(DESKTOP_MODEL_PATH);
}
