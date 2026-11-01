"use client";

import { create } from "zustand";

export type Nav = "frota" | "kanban" | "chat" | "controle" | "graficos" | "supply" | "leakradar";

type UiState = {
  nav: Nav;
  sidebarCollapsed: boolean;
  alvoFoco: string | null;
  setNav: (n: Nav) => void;
  toggleSidebar: () => void;
  focarAlvo: (a: string | null) => void;
};

export const useUi = create<UiState>((set) => ({
  nav: "frota",
  sidebarCollapsed: false,
  alvoFoco: null,
  setNav: (nav) => set({ nav }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  focarAlvo: (alvoFoco) => set({ alvoFoco }),
}));
