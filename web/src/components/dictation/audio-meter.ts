import { useEffect, useRef, useState } from "react";

export type AudioMeterState = {
  level: number;
  isSpeaking: boolean;
  isClipping: boolean;
};

export const DEFAULT_AUDIO_METER: AudioMeterState = {
  level: 0,
  isSpeaking: false,
  isClipping: false,
};

const CLIPPING_THRESHOLD = 0.98;
const CLIPPING_HOLD_MS = 500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useAudioMeter(active: boolean): AudioMeterState {
  const [meter, setMeter] = useState<AudioMeterState>(DEFAULT_AUDIO_METER);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const smoothedLevelRef = useRef(0);
  const noiseFloorRef = useRef(0.008);
  const clippingUntilRef = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (!active) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      setMeter(DEFAULT_AUDIO_METER);
      smoothedLevelRef.current = 0;
      noiseFloorRef.current = 0.008;
      return;
    }

    let isMounted = true;

    async function initAudio() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;

        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyzer = ctx.createAnalyser();
        analyzer.fftSize = 256;
        analyzer.smoothingTimeConstant = 0.3;
        source.connect(analyzer);
        analyzerRef.current = analyzer;

        const sampleBuffer = new Float32Array(analyzer.fftSize);

        const updateMeter = () => {
          if (!isMounted || !analyzerRef.current) return;

          analyzerRef.current.getFloatTimeDomainData(sampleBuffer);

          let sumSquares = 0;
          let peak = 0;
          for (let i = 0; i < sampleBuffer.length; i++) {
            const val = Math.abs(sampleBuffer[i]);
            sumSquares += val * val;
            if (val > peak) peak = val;
          }
          const rms = Math.sqrt(sumSquares / sampleBuffer.length);
          const clampedPeak = clamp(peak, 0, 1);

          const now = Date.now();
          const noiseFloor = Math.max(
            0.004,
            noiseFloorRef.current * 0.96 + Math.min(rms, noiseFloorRef.current * 2) * 0.04,
          );
          noiseFloorRef.current = noiseFloor;

          const rawLevel = clamp((rms - noiseFloor) / 0.16, 0, 1);
          const smoothing = rawLevel > smoothedLevelRef.current ? 0.58 : 0.2;
          const smoothedLevel =
            smoothedLevelRef.current + (rawLevel - smoothedLevelRef.current) * smoothing;
          smoothedLevelRef.current = smoothedLevel;

          if (clampedPeak >= CLIPPING_THRESHOLD) {
            clippingUntilRef.current = now + CLIPPING_HOLD_MS;
          }

          const isClipping = now <= clippingUntilRef.current;
          const isSpeaking = smoothedLevel >= 0.1 || clampedPeak >= 0.18;

          setMeter({
            level: Math.round(smoothedLevel * 100) / 100,
            isSpeaking,
            isClipping,
          });

          animationFrameRef.current = requestAnimationFrame(updateMeter);
        };

        animationFrameRef.current = requestAnimationFrame(updateMeter);
      } catch (err) {
        console.warn("Could not start audio meter analyzer:", err);
      }
    }

    void initAudio();

    return () => {
      isMounted = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [active]);

  return meter;
}
