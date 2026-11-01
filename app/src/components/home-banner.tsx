import React from "react";
import { paleta } from "../paleta.js";
import { sortearTagline } from "../tui/utils/taglines";

// HTC block art — home screen banner, estilo Big Money NW
const HTC_LINES = [
  "██╗  ██╗████████╗ ██████╗",
  "██║  ██║╚══██╔══╝██╔════╝",
  "███████║   ██║   ██║     ",
  "██╔══██║   ██║   ██║     ",
  "██║  ██║   ██║   ╚██████╗",
  "╚═╝  ╚═╝   ╚═╝    ╚═════╝",
];

// gradiente da marca: vermelho claro → vermelho profundo
const LINE_COLORS = [
  "#FF5C7A",
  "#F04E6D",
  "#E04060",
  "#D03353",
  "#C02848",
  "#A81E3B",
];

export function HomeBanner() {
  return (
    <box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      flexShrink={1}
      overflow="hidden"
    >
      <box flexDirection="column" alignItems="center" paddingY={1}>
        {HTC_LINES.map((line, i) => (
          <text key={i} fg={LINE_COLORS[i] ?? paleta.act}>{line}</text>
        ))}
        <text fg="#8E1330" marginTop={1}>
          {sortearTagline()}
        </text>
      </box>
    </box>
  );
}
