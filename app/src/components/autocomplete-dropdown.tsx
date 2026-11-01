import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import { paleta } from "../paleta.js";

export interface SlashCommand {
  name:        string;
  description: string;
  args?:       string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/create",  description: "Forja de tools ofensivas — drainers, exploits, red team max",  args: "<nome> [url]"       },
  { name: "/fc",      description: "Intel de Alvo — OSINT: logo, dados, org, tech stack",            args: "<url|pdf>"         },
  { name: "/atacar",  description: "Framework ofensivo (attack.md + attack-2.md)",                  args: "<foco> <target>"   },
  { name: "/snipar",  description: "Sniper — descoberta de targets (sniper.md)",                    args: "[url]"             },
  { name: "/opsec",   description: "Painel OPSEC completo + VNC",                                   args: ""                  },
  { name: "/bpon",    description: "Bypass permissions ON/OFF",                                     args: ""                  },
  { name: "/delegar", description: "Claude autônomo em nova janela",                                args: "[task]"            },
  { name: "/modelos", description: "Trocar modelo de IA",                                           args: ""                  },
  { name: "/compact", description: "Resumir contexto",                                              args: ""                  },
  { name: "/resume",  description: "Retomar sessão anterior",                                       args: ""                  },
  { name: "/config",  description: "Configuração do HTC",                                           args: ""                  },
  { name: "/clear",   description: "Nova sessão",                                                   args: ""                  },
  { name: "/quit",    description: "Sair do HTCli",                                              args: ""                  },
];

export const DROPDOWN_MAX_HEIGHT = 5;

const CMD_COL = 20;

interface AutocompleteDropdownProps {
  commands:      SlashCommand[];
  selectedIndex: number;
  query:         string;
}

export function AutocompleteDropdown({ commands, selectedIndex, query }: AutocompleteDropdownProps) {
  const { width } = useTerminalDimensions();

  if (commands.length === 0) {
    return (
      <box paddingX={2} paddingY={0}>
        <text fg="#555">Nenhum comando: /{query}</text>
      </box>
    );
  }

  const half     = Math.floor(DROPDOWN_MAX_HEIGHT / 2);
  const winStart = Math.max(0, Math.min(selectedIndex - half, commands.length - DROPDOWN_MAX_HEIGHT));
  const winEnd   = Math.min(commands.length, winStart + DROPDOWN_MAX_HEIGHT);
  const visible  = commands.slice(winStart, winEnd);

  const maxDescWidth = Math.max(0, Math.min(width, 80) - CMD_COL - 4);

  return (
    <box flexDirection="column" paddingY={0}>
      {visible.map((cmd, i) => {
        const realIdx = winStart + i;
        const isSel   = realIdx === selectedIndex;

        const nameStr = cmd.name + (cmd.args ? " " + cmd.args : "");
        const namePad = " ".repeat(Math.max(0, CMD_COL - nameStr.length));
        const desc    = cmd.description.slice(0, maxDescWidth);

        if (isSel) {
          return (
            <box key={cmd.name} flexDirection="row" paddingX={2} paddingY={0}>
              <text fg={paleta.act}>{nameStr}</text>
              <text fg="#333">{namePad}</text>
              <text fg={paleta.plan}>{desc}</text>
            </box>
          );
        }
        return (
          <box key={cmd.name} flexDirection="row" paddingX={2} paddingY={0}>
            <text fg="#555">{nameStr}</text>
            <text fg="#555">{namePad}</text>
            <text fg="#333">{desc}</text>
          </box>
        );
      })}
    </box>
  );
}
