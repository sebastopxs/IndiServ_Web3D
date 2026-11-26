/**
 * ChassisScene.jsx — Escena WebGL (React Three Fiber) con iluminación, cámara, sombras y controles orbitales.
 */

import React, { Suspense, useRef, useEffect, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Lightformer, Bounds, ContactShadows, useBounds, Center, Html, useProgress, Grid } from '@react-three/drei';
import HardwareAssembler from './HardwareAssembler';

function Loader() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div className="flex flex-col items-center bg-zinc-950/90 px-8 py-6 rounded-2xl border border-white/10 backdrop-blur-xl shadow-2xl min-w-[240px]">
        <div className="relative w-14 h-14 mb-4">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
            <circle
              cx="28" cy="28" r="24" fill="none" stroke="#10b981" strokeWidth="3"
              strokeDasharray={`${(progress / 100) * 150.8} 150.8`}
              strokeLinecap="round"
              className="transition-all duration-300"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-mono text-white/70">{progress.toFixed(0)}%</span>
        </div>
        <span className="text-emerald-400/80 font-medium uppercase tracking-[0.2em] text-[10px]">Cargando modelo 3D</span>
      </div>
    </Html>
  );
}

function FocusWrapper({ children }) {
  const api = useBounds();
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta <= 2 && e.object) {
          try {
            api.refresh(e.object).fit();
          } catch (err) {
            console.warn("Bounds could not calculate fit for this object.");
          }
        }
      }}
      onPointerMissed={(e) => {
        if (e.button === 0) {
          try {
            api.refresh().fit();
          } catch (err) {

          }
        }
      }}
    >
      {children}
    </group>
  );
}

function CameraReset({ onReset }) {
  const api = useBounds();
  useEffect(() => {
    if (onReset) {
      onReset(() => {
        try {
          api.refresh().fit();
        } catch (e) {}
      });
    }
  }, [api, onReset]);
  return null;
}

export default function ChassisScene({ profile, telemetry, onSelectComponent, explodedView, registerReset }) {
  const controlsRef = useRef();
  const isMobilePerf = useMemo(() => {
    try {
      if (Capacitor.isNativePlatform()) return true;
    } catch {}
    return typeof window !== 'undefined' && window.innerWidth < 1024;
  }, []);

  return (
    <div className="w-full h-full">
      <Canvas
        shadows
        camera={{ position: [-12, 7, 14], fov: 38 }}
        dpr={isMobilePerf ? [1, 1.25] : [1, 1.5]}
        gl={{ powerPreference: 'high-performance', antialias: false, preserveDrawingBuffer: false }}
      >
        <color attach="background" args={['#09090b']} />
        <fog attach="fog" args={['#09090b', 25, 55]} />

        <ambientLight intensity={0.45} />
        <directionalLight
          position={[12, 18, 10]}
          intensity={2.2}
          castShadow
          shadow-bias={-0.0001}
          shadow-mapSize={isMobilePerf ? [512, 512] : [1024, 1024]}
        />
        <directionalLight position={[-8, 6, -12]} intensity={0.85} color="#e2e8f0" />
        <directionalLight position={[0, 4, -16]} intensity={0.65} color="#06b6d4" />

        <Suspense fallback={<Loader />}>
          <Bounds fit clip observe margin={1.3}>
            <CameraReset onReset={registerReset} />
            <FocusWrapper>
              <Center>
                <HardwareAssembler
                  profile={profile}
                  telemetry={telemetry}
                  onSelect={onSelectComponent}
                  explodedView={explodedView}
                />
              </Center>
            </FocusWrapper>
          </Bounds>

          <Grid
            renderOrder={-1}
            position={[0, -4.5, 0]}
            infiniteGrid
            cellSize={0.8}
            cellThickness={0.4}
            sectionSize={4}
            sectionThickness={0.8}
            cellColor="#1c1c1f"
            sectionColor="#27272a"
            fadeDistance={35}
            raycast={() => null}
          />
          <ContactShadows
            resolution={isMobilePerf ? 256 : 512}
            frames={1}
            scale={35}
            blur={2}
            opacity={0.45}
            far={8}
            color="#000"
            position={[0, -4.5, 0]}
            raycast={() => null}
          />
          <Environment resolution={isMobilePerf ? 64 : 128} frames={1}>
            <Lightformer form="rect" intensity={2.2} position={[0, 10, 6]} scale={[14, 6, 1]} color="#f8fafc" />
            <Lightformer form="rect" intensity={1.3} position={[-10, 4, -6]} scale={[10, 6, 1]} color="#cbd5e1" />
            <Lightformer form="rect" intensity={1.1} position={[10, 3, -8]} scale={[8, 5, 1]} color="#22d3ee" />
          </Environment>
        </Suspense>

        <OrbitControls
          ref={controlsRef}
          makeDefault
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={6}
          maxDistance={35}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>
    </div>
  );
}
