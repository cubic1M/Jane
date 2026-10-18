"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { WAVE_SEPARATION, signColor, waveGrid, waveHeight } from "@/lib/money-wave";

// The landing page's background: a wave of green dollar signs (adapted from a dotted-surface
// component, with each dot drawn as a "$"). It follows the system's light or dark mode,
// holds still for people who prefer reduced motion, pauses while the tab is hidden, and
// sizes itself to its container. Decorative only: hidden from screen readers.

// A white "$" on a transparent square, used as each point's shape; vertex colours tint it.
function dollarTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 104px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function MoneySurface({ className = "" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const width = () => container.clientWidth || window.innerWidth;
    const height = () => container.clientHeight || window.innerHeight;
    const { across, deep } = waveGrid(width());

    const scene = new THREE.Scene();
    // Far signs fade into the page's own background colour.
    // On white, the fade starts further back, or the signs wash out.
    scene.fog = new THREE.Fog(dark ? 0x0a0a0a : 0xffffff, dark ? 2000 : 3500, 10000);

    const camera = new THREE.PerspectiveCamera(60, width() / height(), 1, 10000);
    camera.position.set(0, 355, 1220);
    // Tilted up a little, so the wave sits low behind the hero, clear of the words.
    camera.rotation.x = 0.14;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width(), height());
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const positions: number[] = [];
    const colors: number[] = [];
    for (let ix = 0; ix < across; ix++) {
      for (let iy = 0; iy < deep; iy++) {
        positions.push(
          ix * WAVE_SEPARATION - (across * WAVE_SEPARATION) / 2,
          0,
          iy * WAVE_SEPARATION - (deep * WAVE_SEPARATION) / 2,
        );
        // The greens are sRGB; three.js works in linear colour, so convert them, or they
        // come out washed-out.
        const [r, g, b] = signColor(ix, iy, dark);
        const color = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
        colors.push(color.r, color.g, color.b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const texture = dollarTexture();
    const material = new THREE.PointsMaterial({
      size: 42,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: dark ? 0.75 : 0.95,
      alphaTest: 0.2,
      depthWrite: false,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(geometry, material));

    let t = 0;
    let frame = 0;
    const draw = () => {
      const array = geometry.attributes.position.array as Float32Array;
      let i = 0;
      for (let ix = 0; ix < across; ix++) {
        for (let iy = 0; iy < deep; iy++) {
          array[i * 3 + 1] = waveHeight(ix, iy, t);
          i++;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    };
    const animate = () => {
      draw();
      t += 0.06;
      frame = requestAnimationFrame(animate);
    };
    const start = () => {
      if (still) draw();
      else if (!frame) frame = requestAnimationFrame(animate);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    const resize = () => {
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
      renderer.setSize(width(), height());
      if (still) draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    />
  );
}

export default MoneySurface;
