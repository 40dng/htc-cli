import { useEffect, useRef, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      ref.current = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 80);
    } else {
      if (ref.current) clearInterval(ref.current);
      setFrame(0);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [active]);

  return FRAMES[frame]!;
}
