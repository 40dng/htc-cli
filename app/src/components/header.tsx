import React from "react";
import { paleta } from "../paleta.js";
import { ClawdAnimated } from "./clawd-animated.js";

interface HeaderProps {
  version: string;
  model:   string;
}

export function Header({ version, model }: HeaderProps) {
  const cwd = process.cwd().replace(
    process.env.USERPROFILE ?? process.env.HOME ?? "",
    "~"
  );
  const cwdTrunc = cwd.length > 40 ? "…" + cwd.slice(-38) : cwd;

  return (
    <box flexDirection="row" paddingX={1} paddingY={0} alignItems="center" gap={2}>
      <ClawdAnimated />
      <box flexDirection="column">
        <text>
          <strong><span fg={paleta.act}>HTCli</span></strong>
          {"  "}
          <span fg="#555">v{version}</span>
        </text>
        <text>
          <span fg="#555">{model}</span>
          {"  ·  "}
          <span fg={paleta.error}><strong>ATTACK</strong></span>
        </text>
        <text fg="#444">{cwdTrunc}</text>
      </box>
    </box>
  );
}
