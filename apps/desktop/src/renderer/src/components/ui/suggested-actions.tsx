import { ArrowUpRight, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@renderer/lib/utils";

export function SuggestedActions({
  suggestions,
  onSelect,
  className,
}: {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className={cn("grid gap-2 sm:grid-cols-3", className)} aria-label="Sugestões para começar">
      {suggestions.map((suggestion, index) => (
        <motion.button
          key={suggestion}
          type="button"
          className="group relative min-h-[92px] overflow-hidden rounded-[12px] border border-border bg-surface p-3.5 text-left text-[11px] leading-4 text-text-muted transition-[border-color,background-color,color] hover:border-primary/30 hover:bg-primary/[0.035] hover:text-text"
          initial={reduceMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          {...(reduceMotion ? {} : { whileHover: { y: -2 }, whileTap: { scale: 0.99 } })}
          transition={{ duration: reduceMotion ? 0 : 0.2, delay: reduceMotion ? 0 : index * 0.05 }}
          onClick={() => onSelect(suggestion)}
        >
          <span className="mb-3 flex items-center justify-between">
            <span className="grid size-7 place-items-center rounded-[8px] border border-border bg-bg-elevated text-primary-soft transition-colors group-hover:border-primary/20 group-hover:bg-primary/10">
              <Sparkles size={12} />
            </span>
            <span className="flex items-center gap-1 text-[9px] font-semibold tabular-nums text-text-faint">
              0{index + 1}
              <ArrowUpRight
                size={11}
                className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </span>
          </span>
          {suggestion}
        </motion.button>
      ))}
    </div>
  );
}
