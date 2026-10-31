import React from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DictationGrapes } from "./DictationGrapes";
import { cn } from "@/lib/utils";
import type { AudioMeterState } from "./audio-meter";

export type DictationState = "idle" | "starting" | "listening" | "stopping";

export function DictationIndicator({
  state,
  meter,
  partialTranscript,
  onStop,
}: {
  state: DictationState;
  meter: AudioMeterState;
  partialTranscript: string;
  onStop: () => void;
}) {
  if (state === "idle") {
    return null;
  }

  const isListening = state === "listening";
  const isClipping = isListening && meter.isClipping;
  const isSpeaking = isListening && meter.isSpeaking && !isClipping;

  const lifecycleLabel =
    state === "starting"
      ? "Microphone en cours…"
      : state === "stopping"
        ? "Traitement…"
        : "À l’écoute";

  const label = isClipping
    ? "Trop fort"
    : isSpeaking
      ? "En train de parler"
      : lifecycleLabel;

  const transcript = partialTranscript.trim();

  return (
    <div
      data-testid="dictation-indicator"
      className={cn(
        "fixed bottom-14 left-1/2 z-[100] -translate-x-1/2 overflow-hidden",
        "border border-border/80 bg-[#161619]/95 text-sm text-foreground shadow-[0_16px_36px_rgba(0,0,0,0.5)] backdrop-blur-xl",
        "transition-[width,border-radius,opacity] duration-200 ease-out motion-reduce:transition-none",
        transcript
          ? "w-[min(28rem,calc(100vw-2rem))] rounded-xl"
          : "max-w-[min(28rem,calc(100vw-2rem))] rounded-full",
        isClipping && "border-destructive/40 text-destructive",
      )}
    >
      <div className="flex h-10 items-center gap-2 px-3">
        <DictationGrapes
          level={meter.level}
          active={state !== "stopping"}
          transitioning={state !== "listening"}
        />
        <span aria-hidden className="min-w-0 truncate font-medium text-xs">
          {label}
        </span>
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {label}
        </span>
        {state !== "stopping" ? (
          <>
            <span aria-hidden className="ml-1 h-3.5 w-px shrink-0 bg-border/60" />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Arrêter la dictée"
              title="Arrêter la dictée"
              className="shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground ml-0.5"
              onClick={onStop}
            >
              <Square className="size-2.5 fill-current" />
            </Button>
          </>
        ) : null}
      </div>
      {transcript ? (
        <p className="truncate border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground font-normal">
          {transcript}
        </p>
      ) : null}
    </div>
  );
}

