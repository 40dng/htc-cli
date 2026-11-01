"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* better-ui: press 0.96 em 150ms ease-out, nunca em disabled; transicao nomeia a propriedade. */
const botao = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ease-[var(--ease-out-ui)] outline-none focus-visible:shadow-[0_0_0_2px_var(--ring)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary)_88%,black)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline: "border border-border bg-transparent text-foreground hover:bg-accent",
        danger: "border border-[#6b1f1f] text-[#ffb3b3] hover:bg-[#2a1212]",
        success: "border border-[#0f6b41] text-[#8affc8] hover:bg-[#10241a]",
      },
      size: {
        sm: "h-7 px-2",
        md: "h-8 px-2.5",
        lg: "h-9 px-3",
        icon: "size-8 p-0",
      },
      estatico: { true: "", false: "" },
    },
    compoundVariants: [
      { estatico: false, class: "transition-[background-color,color,box-shadow,transform] enabled:active:scale-[0.96]" },
    ],
    defaultVariants: { variant: "secondary", size: "md", estatico: false },
  },
);

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof botao> & { estatico?: boolean };

export default function Button({ className, variant, size, estatico, ...props }: Props) {
  return <button className={cn(botao({ variant, size, estatico }), className)} {...props} />;
}
