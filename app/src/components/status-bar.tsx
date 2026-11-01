import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import { paleta } from "../paleta.js";

export interface StatusBarProps {
  model: string;
  mode: string;
  target?: string;
  vps?: string;
  yolo?: boolean;
  streaming?: boolean;
}

export function StatusBar({ model, mode, target, vps, yolo, streaming }: StatusBarProps) {
  const { width } = useTerminalDimensions();
  const modeColor = mode === "attack" || mode === "full" ? paleta.error : paleta.act;
  const rule      = "─".repeat(Math.max(0, width));

  return (
    <box flexDirection="column">
      <text fg="gray">{rule}</text>
      <box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <text fg="gray">
          <span fg={paleta.act}>{model}</span>
          {streaming ? " ⠋" : ""}
        </text>
        <text fg={modeColor}>{mode.toUpperCase()}</text>
        <text fg="gray">
          {target ? `${target}  ` : ""}
          {yolo ? "⚡ yolo  " : ""}
          {vps ?? ""}
        </text>
      </box>
    </box>
  );
}
