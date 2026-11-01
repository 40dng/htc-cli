import { cn } from "@/lib/utils";

/**
 * Marca HTC: koi. Um traco, duas opacidades — a cauda e a nadadeira usam a
 * mesma cor do corpo para o glifo funcionar em 16px e em 112px.
 */
export function Koi({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-8", className)}
    >
      <path
        d="M6.1 16.2C8.6 10.9 14.6 8.2 20.6 9.1c4.4.7 7.4 3.3 8.2 7.1-2.6 5.6-8.6 8.5-15 7.6-4.1-.6-6.9-3-7.7-7.6Z"
        fill="currentColor"
      />
      <path
        d="M6.3 16.4 2.1 11.7c1.2 3.3 1.2 5.5 0 8.7l4.2-4Z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M11.3 21.7c1.2 2.4 3.1 3.8 5.7 4.2-2.2 1.6-4.8 1.5-6.6-.2-.6-.6-.9-1.6-.9-2.6l1.8-1.4Z"
        fill="currentColor"
        opacity="0.55"
      />
      <circle cx="10.4" cy="14.9" r="1" fill="var(--background)" />
    </svg>
  );
}
