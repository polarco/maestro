import type { ButtonHTMLAttributes } from "react";
import { Check, Minus } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@renderer/lib/utils";

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "value"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({
  checked,
  onCheckedChange,
  className,
  disabled,
  type = "button",
  ...props
}: SwitchProps) {
  const reduceMotion = useReducedMotion();
  return (
    <button
      {...props}
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        "relative h-8 w-[54px] shrink-0 rounded-full border p-[3px] transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/65 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        checked
          ? "border-primary/50 bg-primary shadow-[inset_0_1px_2px_rgb(45_43_138/0.22)]"
          : "border-border-strong bg-bg shadow-inner hover:bg-surface-hover",
        disabled && "cursor-default opacity-45",
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <motion.span
        className={cn(
          "grid size-6 place-items-center rounded-full shadow-[0_2px_7px_rgb(0_0_0/0.28)]",
          checked ? "bg-white text-primary-strong" : "bg-surface-raised text-text-faint",
        )}
        initial={false}
        animate={{ x: checked ? 22 : 0 }}
        transition={
          reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 }
        }
        aria-hidden="true"
      >
        {checked ? <Check size={12} strokeWidth={2.7} /> : <Minus size={12} strokeWidth={2.2} />}
      </motion.span>
    </button>
  );
}
