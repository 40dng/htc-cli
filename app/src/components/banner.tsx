import React from "react";
import { paleta } from "../paleta.js";

const LINHAS = [
  " $$\\      $$\\ $$\\   $$\\  $$$$$$\\  ",
  " $$$\\    $$$ |$$ |  $$ |$$  __$$\\ ",
  " $$$$\\  $$$$ |\\$$\\ $$  |$$ /  \\__|",
  " $$\\$$\\$$ $$ | \\$$$$  / $$ |      ",
  " $$ \\$$$  $$ | $$  $$<  $$ |      ",
  " $$ |\\$  /$$ |$$  /\\$$\\ $$ |  $$\\ ",
  " $$ | \\_/ $$ |$$ /  $$ |\\$$$$$$  |",
  " \\__|     \\__|\\__|  \\__| \\______/ ",
];

// Mistura o accent da marca por linha: #FF5C7A → #A81E3B
function lineColor(idx: number, total: number): string {
  const t = total <= 1 ? 0 : idx / (total - 1);
  const r = Math.round(255 - t * (255 - 168));
  const g = Math.round(92 - t * (92 - 30));
  const b = Math.round(122 - t * (122 - 59));
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function Banner({ version = "1.0.0" }: { version?: string }) {
  const total = LINHAS.length;
  return (
    <box flexDirection="column" alignItems="flex-start" marginTop={1} marginBottom={1}>
      {LINHAS.map((linha, idx) => (
        <text key={idx} fg={lineColor(idx, total)}>
          <strong>{linha}</strong>
        </text>
      ))}
      <text fg="gray" marginTop={1}>
        {"    "}
        <span fg="#ffffff">
          <strong>CLI pessoal de MX</strong>
        </span>
        {"  "}
        <span fg="gray">v{version}</span>
      </text>
    </box>
  );
}
