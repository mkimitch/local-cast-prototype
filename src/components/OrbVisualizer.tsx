import React, { useEffect, useRef } from 'react';

export type OrbThemeName =
  | 'amber'
  | 'arctic'
  | 'bioluminescent'
  | 'emerald'
  | 'violet'
  | 'bluePurple'
  | 'blueRed'
  | 'magentaCopper'
  | 'solar'
  | 'cyanRose'
  | 'cyberCyan'
  | 'holoMint'
  | 'ionViolet'
  | 'synthwaveSignal'
  | 'quantumBlue'
  | 'reactorGreen'
  | 'ultraviolet'
  | 'thermalVision';

export type OrbTheme = {
  accent: string;
  background: string;
  backgroundGlow: string;
  core: string;
  coreSecondary: string;
  mid: string;
  rim: string;
  rings: string;
  ticks: string;
};

export const ORB_THEMES: Record<OrbThemeName, OrbTheme> = {
  amber: {
    background: '#080403',
    backgroundGlow: '#3a1b0a',
    core: '#ffd27a',
    coreSecondary: '#fff0b8',
    mid: '#f59e2e',
    rim: '#c76a1c',
    rings: '#ffb347',
    ticks: '#c9873a',
    accent: '#ffdf9a',
  },
  arctic: {
    background: '#020814',
    backgroundGlow: '#103252',
    core: '#bfeaff',
    coreSecondary: '#f2fbff',
    mid: '#4db8ff',
    rim: '#1768c8',
    rings: '#6fd6ff',
    ticks: '#7aa7c7',
    accent: '#d9f6ff',
  },
  bioluminescent: {
    background: '#020b0d',
    backgroundGlow: '#073c3a',
    core: '#cafff2',
    coreSecondary: '#7fffe3',
    mid: '#28f0c7',
    rim: '#087c78',
    rings: '#3bd9ff',
    ticks: '#5ee6b8',
    accent: '#9efff2',
  },
  emerald: {
    background: '#020805',
    backgroundGlow: '#0b3a22',
    core: '#d7ffd6',
    coreSecondary: '#b8ffc6',
    mid: '#5cff8d',
    rim: '#14964a',
    rings: '#2ee66b',
    ticks: '#76d99a',
    accent: '#d7ff73',
  },
  violet: {
    background: '#080312',
    backgroundGlow: '#30104d',
    core: '#f0d5ff',
    coreSecondary: '#fff2ff',
    mid: '#b96cff',
    rim: '#6f31d1',
    rings: '#8f5cff',
    ticks: '#c9a3ff',
    accent: '#ff8df4',
  },
  bluePurple: {
    background: '#030716',
    backgroundGlow: '#1c2f73',
    core: '#dce9ff',
    coreSecondary: '#f3f7ff',
    mid: '#7c9cff',
    rim: '#743cff',
    rings: '#a56cff',
    ticks: '#8fb3ff',
    accent: '#63e6ff',
  },
  blueRed: {
    background: '#070711',
    backgroundGlow: '#243d7a',
    core: '#ffe1df',
    coreSecondary: '#fff5f0',
    mid: '#ff5f5f',
    rim: '#335dff',
    rings: '#4da3ff',
    ticks: '#ff9a7a',
    accent: '#ffcc66',
  },
  magentaCopper: {
    background: '#0a0308',
    backgroundGlow: '#4a1730',
    core: '#ffd8bd',
    coreSecondary: '#fff0dd',
    mid: '#ff7a7a',
    rim: '#b33c72',
    rings: '#ff4fd8',
    ticks: '#d8895f',
    accent: '#ffb37a',
  },
  solar: {
    background: '#050505',
    backgroundGlow: '#34301d',
    core: '#fff7d1',
    coreSecondary: '#ffffff',
    mid: '#ffd96a',
    rim: '#b89228',
    rings: '#ffef9a',
    ticks: '#c8ad5d',
    accent: '#fff2aa',
  },
  cyanRose: {
    background: '#040711',
    backgroundGlow: '#173763',
    core: '#fff0f6',
    coreSecondary: '#ffffff',
    mid: '#ff6fae',
    rim: '#53d7ff',
    rings: '#53d7ff',
    ticks: '#b6a8ff',
    accent: '#ffaad2',
  },
  cyberCyan: {
    background: '#020712',
    backgroundGlow: '#062a4a',
    core: '#d9fbff',
    coreSecondary: '#ffffff',
    mid: '#00d5ff',
    rim: '#0077ff',
    rings: '#4de7ff',
    ticks: '#7adfff',
    accent: '#9bf6ff',
  },
  holoMint: {
    background: '#03090b',
    backgroundGlow: '#063832',
    core: '#eafff8',
    coreSecondary: '#ffffff',
    mid: '#78ffd6',
    rim: '#42b8ff',
    rings: '#83ffe8',
    ticks: '#a8fff0',
    accent: '#d8fff6',
  },
  ionViolet: {
    background: '#060212',
    backgroundGlow: '#22105c',
    core: '#f4dcff',
    coreSecondary: '#fff6ff',
    mid: '#bc6cff',
    rim: '#5f4dff',
    rings: '#9c7cff',
    ticks: '#c7a7ff',
    accent: '#ff8df4',
  },
  synthwaveSignal: {
    background: '#080316',
    backgroundGlow: '#25105a',
    core: '#fff0fa',
    coreSecondary: '#ffffff',
    mid: '#ff4fd8',
    rim: '#4f7dff',
    rings: '#ff5fd2',
    ticks: '#8ff3ff',
    accent: '#00e5ff',
  },
  quantumBlue: {
    background: '#010611',
    backgroundGlow: '#0a2261',
    core: '#e6f7ff',
    coreSecondary: '#ffffff',
    mid: '#62b7ff',
    rim: '#264bff',
    rings: '#7ddcff',
    ticks: '#93b8ff',
    accent: '#b8a7ff',
  },
  reactorGreen: {
    background: '#010806',
    backgroundGlow: '#06351e',
    core: '#ecffe8',
    coreSecondary: '#ffffff',
    mid: '#7dff8a',
    rim: '#00d46a',
    rings: '#7cffc4',
    ticks: '#9affb2',
    accent: '#d7ff73',
  },
  ultraviolet: {
    background: '#05010d',
    backgroundGlow: '#240644',
    core: '#f5e8ff',
    coreSecondary: '#ffffff',
    mid: '#d65cff',
    rim: '#6c2cff',
    rings: '#b983ff',
    ticks: '#cda7ff',
    accent: '#ff6ad5',
  },
  thermalVision: {
    background: '#040611',
    backgroundGlow: '#17275f',
    core: '#fff4e8',
    coreSecondary: '#ffffff',
    mid: '#ff6a3d',
    rim: '#246bff',
    rings: '#5ab8ff',
    ticks: '#ff9f7a',
    accent: '#ffcc66',
  },
};

export interface OrbVisualizerProps {
  audioLevel?: number; // 0.0 to 1.0
  frequencies?: [number, number, number]; // [low, mid, high] (0.0 to 1.0)
  isActive?: boolean;
  className?: string;
  theme?: OrbThemeName;
}

export default function OrbVisualizer({
  audioLevel = 0,
  frequencies = [0, 0, 0],
  isActive = false,
  className = '',
  theme = 'amber',
}: OrbVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const propsRef = useRef({ audioLevel, frequencies, isActive, theme });
  
  useEffect(() => {
    propsRef.current = { audioLevel, frequencies, isActive, theme };
  }, [audioLevel, frequencies, isActive, theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;
    
    // Smooth variables
    let currentLevel = 0;
    let currentLow = 0;
    let currentMid = 0;
    let currentHigh = 0;
    
    const rings: { radius: number; maxRadius: number; opacity: number; speed: number }[] = [];
    let lastPeakTime = 0;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Handle resizing
    let w = container.clientWidth;
    let h = container.clientHeight;
    
    const resize = () => {
      w = container.clientWidth;
      h = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    };
    
    const resizeObserver = new ResizeObserver(() => {
      resize();
    });
    resizeObserver.observe(container);
    resize();

    const getAlphaColor = (color: string, alpha: number) => {
      return `color-mix(in oklch, ${color} ${Math.round(Math.max(0, Math.min(1, alpha)) * 100)}%, transparent)`;
    };

    const draw = () => {
      const p = propsRef.current;
      
      // Smoothing inputs
      currentLevel += (p.audioLevel - currentLevel) * 0.15;
      currentLow += (p.frequencies[0] - currentLow) * 0.15;
      currentMid += (p.frequencies[1] - currentMid) * 0.15;
      currentHigh += (p.frequencies[2] - currentHigh) * 0.15;

      const motionScale = prefersReducedMotion ? 0.3 : 1.0;
      time += 0.01 * motionScale * (1 + currentLevel * 2);

      const cx = w / 2;
      const cy = h / 2;
      const minDim = Math.min(w, h);

      const t = ORB_THEMES[p.theme] || ORB_THEMES.amber;

      // 1. Background
      ctx.fillStyle = t.background;
      ctx.fillRect(0, 0, w, h);

      // Vignette
      const glowRadius = minDim * 0.7;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      gradient.addColorStop(0, getAlphaColor(t.backgroundGlow, 0.8 + currentLow * 0.2));
      gradient.addColorStop(1, getAlphaColor(t.backgroundGlow, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // 2. Ticks (Radio Dial)
      ctx.save();
      ctx.translate(cx, cy);
      const tickRadius = minDim * 0.35;
      const numTicks = 60;
      const startAngle = Math.PI * 0.7;
      const endAngle = Math.PI * 2.3;
      
      const highGlow = currentHigh * 0.6;
      
      for (let i = 0; i <= numTicks; i++) {
        const tickNorm = i / numTicks;
        const angle = startAngle + tickNorm * (endAngle - startAngle);
        const isMajor = i % 5 === 0;
        const tickLength = isMajor ? 12 : 6;
        
        const x1 = Math.cos(angle) * tickRadius;
        const y1 = Math.sin(angle) * tickRadius;
        const x2 = Math.cos(angle) * (tickRadius + tickLength);
        const y2 = Math.sin(angle) * (tickRadius + tickLength);
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        
        // Tick opacity pulses with high frequencies
        const alpha = 0.05 + (isMajor ? 0.08 : 0) + highGlow * (Math.sin(i * 0.5 + time * 5) * 0.5 + 0.5);
        ctx.strokeStyle = getAlphaColor(t.ticks, alpha);
        ctx.lineWidth = isMajor ? 1.5 : 1;
        ctx.stroke();
      }
      ctx.restore();

      // 3. Rings
      if (p.isActive && currentLevel > 0.4 && time - lastPeakTime > 0.5) {
        rings.push({
          radius: minDim * 0.15,
          maxRadius: minDim * 0.45,
          opacity: 0.5 + currentLevel * 0.3,
          speed: 1 + currentLevel * 3
        });
        lastPeakTime = time;
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.radius += r.speed * motionScale;
        r.opacity -= 0.005 * motionScale;
        
        if (r.opacity <= 0 || r.radius >= r.maxRadius) {
          rings.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(cx, cy, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = getAlphaColor(t.rings, r.opacity * 0.4);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 4. Glowing Orb
      ctx.save();
      ctx.translate(cx, cy);

      const baseRadius = minDim * 0.15 * (1 + currentLow * 0.2 + (p.isActive ? 0.05 : 0));
      
      // Draw organic shape path
      ctx.beginPath();
      const numPoints = 120;
      for (let i = 0; i <= numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        
        // Liquid turbulence
        const tTime = time * 2;
        const wave1 = Math.sin(angle * 3 + tTime) * 0.06;
        const wave2 = Math.cos(angle * 5 - tTime * 1.5) * 0.04;
        const wave3 = Math.sin(angle * 7 + tTime * 3) * (0.03 * currentMid);
        const wave4 = Math.sin(angle * 15 + tTime * 5) * (0.015 * currentHigh); // High frequency shimmer
        
        const noise = (wave1 + wave2 + wave3 + wave4) * motionScale * (1 + currentLevel * 1.5);
        
        const r = baseRadius * (1 + noise);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Outer Bloom (Shadows)
      ctx.shadowColor = getAlphaColor(t.accent, 0.4 + currentLevel * 0.4);
      ctx.shadowBlur = 30 + currentMid * 40;
      ctx.fillStyle = t.rim;
      ctx.fill(); // Fills the path to create the outer shadow
      ctx.shadowBlur = 0; // Reset shadow

      // Clip to the fluid path for internal plasma rendering
      ctx.clip();

      // Base internal gradient
      const orbGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, baseRadius * 1.2);
      orbGrad.addColorStop(0, t.core);
      orbGrad.addColorStop(0.3, t.coreSecondary);
      orbGrad.addColorStop(0.7, t.mid);
      orbGrad.addColorStop(1, t.rim);
      ctx.fillStyle = orbGrad;
      ctx.fill();

      // Plasma blobs inside the orb
      const drawBlob = (angleOffset: number, speed: number, radiusScale: number, color: string, alpha: number) => {
        const x = Math.cos(time * speed + angleOffset) * baseRadius * 0.5;
        const y = Math.sin(time * speed * 1.2 + angleOffset) * baseRadius * 0.5;
        const blobRadius = baseRadius * radiusScale;
        const blobGrad = ctx.createRadialGradient(x, y, 0, x, y, blobRadius);
        blobGrad.addColorStop(0, getAlphaColor(color, alpha));
        blobGrad.addColorStop(1, getAlphaColor(color, 0));
        ctx.fillStyle = blobGrad;
        ctx.fillRect(-baseRadius * 2, -baseRadius * 2, baseRadius * 4, baseRadius * 4);
      };

      // Moving plasma blobs to create dimensional, fluid internal energy
      drawBlob(0, 0.5, 0.9, t.coreSecondary, 0.6 + currentLow * 0.4);
      drawBlob(Math.PI * 0.66, -0.4, 1.1, t.mid, 0.7 + currentMid * 0.3);
      drawBlob(Math.PI * 1.33, 0.7, 0.8, t.accent, currentLevel * 0.9);

      // Subtle inner rim highlight for dimensionality
      ctx.strokeStyle = getAlphaColor(t.core, 0.3 + currentHigh * 0.3);
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.restore();

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, []); // Run setup once

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`} style={{ backgroundColor: ORB_THEMES[theme]?.background || '#000' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
