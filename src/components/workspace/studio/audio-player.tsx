"use client";

import { Download, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/format";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function AudioPlayer({ src, downloadHref, initialDuration, onError }: { src: string; downloadHref: string; initialDuration?: number | null; onError?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration ?? 0);
  const [speed, setSpeed] = useState(1);
  const [seeking, setSeeking] = useState<number | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        onError?.();
      }
    } else audio.pause();
  };

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
  };

  return (
    <div className="rounded-xl border bg-background p-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onError={onError}
      />
      <div className="flex items-center gap-2">
        <Button size="icon" className="size-10 shrink-0 rounded-full" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
        </Button>
        <div className="min-w-0 flex-1">
          <Slider
            value={[seeking ?? time]}
            max={duration || 1}
            step={0.5}
            onValueChange={([v]) => setSeeking(v)}
            onValueCommit={([v]) => {
              if (audioRef.current) audioRef.current.currentTime = v;
              setTime(v);
              setSeeking(null);
            }}
            aria-label="Seek"
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{formatDuration(seeking ?? time)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" onClick={() => skip(-10)} aria-label="Back 10 seconds">
            <RotateCcw />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => skip(10)} aria-label="Forward 10 seconds">
            <RotateCw />
          </Button>
          <Button variant="ghost" size="sm" className="tabular-nums" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} aria-label="Playback speed">
            {speed}×
          </Button>
        </div>
        <Button asChild variant="ghost" size="sm">
          <a href={downloadHref}>
            <Download /> Download
          </a>
        </Button>
      </div>
    </div>
  );
}
