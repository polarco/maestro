import { useId } from "react";
import { CheckCircle2, MonitorCog, MoonStar, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ThemePreference } from "@renderer/lib/theme";
import { cn } from "@renderer/lib/utils";

const options: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: "light",
    label: "Claro",
    description: "Superfícies claras e alto contraste",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Escuro",
    description: "Confortável para ambientes com pouca luz",
    icon: MoonStar,
  },
  {
    value: "system",
    label: "Sistema",
    description: "Acompanha a preferência do dispositivo",
    icon: MonitorCog,
  },
];

interface ThemeControlProps {
  value: ThemePreference;
  onValueChange: (value: ThemePreference) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function ThemeToggle({
  value,
  onValueChange,
  disabled = false,
  className,
}: ThemeControlProps) {
  const name = useId();
  const reduceMotion = useReducedMotion();
  const compactOptions = [options[2]!, options[0]!, options[1]!];

  return (
    <div
      className={cn(
        "inline-flex h-8 items-center rounded-full border border-border bg-bg-elevated/85 p-0.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.035),0_4px_14px_rgb(0_0_0/0.08)]",
        disabled && "opacity-60",
        className,
      )}
      role="radiogroup"
      aria-label="Tema da interface"
    >
      {compactOptions.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "theme-option relative grid size-[26px] place-items-center rounded-full text-text-faint transition-colors",
              active ? "text-primary-foreground" : "hover:text-text-muted",
              disabled ? "cursor-default" : "cursor-pointer",
            )}
            title={
              option.value === "system"
                ? "Usar tema do sistema"
                : `Usar tema ${option.label.toLowerCase()}`
            }
          >
            <input
              className="peer sr-only"
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              disabled={disabled}
              aria-label={
                option.value === "system"
                  ? "Usar tema do sistema"
                  : `Usar tema ${option.label.toLowerCase()}`
              }
              onChange={() => onValueChange(option.value)}
            />
            {active ? (
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 rounded-full border border-primary bg-primary shadow-[0_4px_12px_-6px_rgb(251_65_55/0.8)]"
                layoutId={`compact-theme-${name}`}
                transition={
                  reduceMotion ? { duration: 0 } : { type: "spring", bounce: 0.08, duration: 0.48 }
                }
              />
            ) : null}
            <motion.span
              className="relative z-10"
              aria-hidden="true"
              animate={{ rotate: active ? 0 : -8, scale: active ? 1 : 0.9 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              <Icon size={13} strokeWidth={active ? 2.1 : 1.8} />
            </motion.span>
          </label>
        );
      })}
    </div>
  );
}

export function ThemePicker({
  value,
  onValueChange,
  disabled = false,
  className,
}: ThemeControlProps) {
  const name = useId();
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={cn("grid gap-2 sm:grid-cols-3", className)}
      role="radiogroup"
      aria-label="Aparência da interface"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "theme-option group relative flex min-h-[82px] items-center gap-3 overflow-hidden rounded-[14px] border bg-bg-elevated p-3.5 transition-[border-color,background-color,transform]",
              active
                ? "border-primary/45 bg-primary/[0.055]"
                : "border-border hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-hover/40",
              disabled ? "cursor-default opacity-60" : "cursor-pointer",
            )}
          >
            <input
              className="peer sr-only"
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              disabled={disabled}
              aria-label={`Tema ${option.label.toLowerCase()}`}
              onChange={() => onValueChange(option.value)}
            />
            {active ? (
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[13px] ring-1 ring-inset ring-primary/28"
                layoutId={`settings-theme-${name}`}
                transition={
                  reduceMotion ? { duration: 0 } : { type: "spring", bounce: 0.08, duration: 0.52 }
                }
              />
            ) : null}
            <span
              className={cn(
                "relative grid size-10 shrink-0 place-items-center rounded-[12px] border transition-colors",
                active
                  ? "border-primary/25 bg-primary/12 text-primary-soft"
                  : "border-border bg-surface text-text-faint group-hover:text-text-muted",
              )}
              aria-hidden="true"
            >
              <Icon size={17} />
            </span>
            <span className="relative min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
                {option.label}
                {active ? <CheckCircle2 size={12} className="text-primary-soft" /> : null}
              </span>
              <span className="mt-1 block text-[9.5px] leading-4 text-text-faint">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
