import React, { useEffect, useRef, useState } from "react";

// Porta exata do AnimatedClawd + Clawd do claude-code (LogoV2)
// Mesmas poses, mesmos segmentos, mesma lógica JUMP_WAVE/LOOK_AROUND.

type ClawdPose = "default" | "arms-up" | "look-left" | "look-right";
type Frame = { pose: ClawdPose; offset: number };

// Segmentos idênticos ao Clawd.tsx do claude-code (9 cols wide)
const POSES: Record<ClawdPose, {
  r1L: string; r1E: string; r1R: string;
  r2L: string; r2R: string;
}> = {
  "default":    { r1L: " ▐", r1E: "▛███▜", r1R: "▌",  r2L: "▝▜", r2R: "▛▘" },
  "look-left":  { r1L: " ▐", r1E: "▟███▟", r1R: "▌",  r2L: "▝▜", r2R: "▛▘" },
  "look-right": { r1L: " ▐", r1E: "▙███▙", r1R: "▌",  r2L: "▝▜", r2R: "▛▘" },
  "arms-up":    { r1L: "▗▟", r1E: "▛███▜", r1R: "▙▖", r2L: " ▜", r2R: "▛ " },
};

// Animações idênticas ao AnimatedClawd.tsx do claude-code
function hold(pose: ClawdPose, offset: number, frames: number): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset }));
}

const JUMP_WAVE: readonly Frame[] = [
  ...hold("default",  1, 2), // crouch
  ...hold("arms-up",  0, 3), // spring!
  ...hold("default",  0, 1),
  ...hold("default",  1, 2), // crouch again
  ...hold("arms-up",  0, 3), // spring!
  ...hold("default",  0, 1),
];

const LOOK_AROUND: readonly Frame[] = [
  ...hold("look-right", 0, 5),
  ...hold("look-left",  0, 5),
  ...hold("default",    0, 1),
];

const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP_WAVE, LOOK_AROUND];
const IDLE: Frame  = { pose: "default", offset: 0 };
const FRAME_MS     = 60; // igual ao claude-code
export const CLAWD_HEIGHT = 3; // 3 rows, igual ao claude-code

// Accent HTC — não existe mais o verde ofensivo
const C = "#CB1B45";

function useClawdAnimation() {
  const [frameIndex, setFrameIndex] = useState(-1);
  const sequenceRef = useRef<readonly Frame[]>(JUMP_WAVE);

  // Avança frame a frame (igual ao claude-code)
  useEffect(() => {
    if (frameIndex === -1) return;
    if (frameIndex >= sequenceRef.current.length) { setFrameIndex(-1); return; }
    const timer = setTimeout(setFrameIndex, FRAME_MS, (i: number) => i + 1);
    return () => clearTimeout(timer);
  }, [frameIndex]);

  // Auto-anima em idle a cada 4-7s (substitui o onClick do claude-code)
  useEffect(() => {
    const timer = setInterval(() => {
      if (frameIndex !== -1) return;
      sequenceRef.current = CLICK_ANIMATIONS[Math.floor(Math.random() * CLICK_ANIMATIONS.length)]!;
      setFrameIndex(0);
    }, 4000 + Math.random() * 3000);
    return () => clearInterval(timer);
  }, [frameIndex]);

  const seq = sequenceRef.current;
  const current = frameIndex >= 0 && frameIndex < seq.length ? seq[frameIndex]! : IDLE;
  return { pose: current.pose, bounceOffset: current.offset };
}

export function ClawdAnimated() {
  const { pose, bounceOffset } = useClawdAnimation();
  const p = POSES[pose];

  return (
    // container height=3 fixo — igual ao claude-code (layout nunca shifta)
    <box height={CLAWD_HEIGHT} flexDirection="column" flexShrink={0}>
      <box marginTop={bounceOffset} flexDirection="column" flexShrink={0}>
        {/* row 1 — cabeça */}
        <text>
          <span fg={C}>{p.r1L}</span>
          <span fg={C}>{p.r1E}</span>
          <span fg={C}>{p.r1R}</span>
        </text>
        {/* row 2 — corpo */}
        <text>
          <span fg={C}>{p.r2L}</span>
          <span fg={C}>{"█████"}</span>
          <span fg={C}>{p.r2R}</span>
        </text>
        {/* row 3 — pés */}
        <text fg={C}>{"  "}{"▘▘ ▝▝"}{"  "}</text>
      </box>
    </box>
  );
}
