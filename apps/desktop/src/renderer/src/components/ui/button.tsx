import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@renderer/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[12px] text-[13px] font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/65 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_22px_-12px_rgb(251_65_55/0.72)] hover:bg-primary-strong hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_10px_26px_-12px_rgb(251_65_55/0.82)] disabled:bg-primary/35 disabled:text-text-faint disabled:shadow-none",
        secondary:
          "border border-border bg-surface-raised text-text shadow-[0_1px_1px_rgb(0_0_0/0.08)] hover:border-border-strong hover:bg-surface-hover",
        ghost: "text-text-muted hover:bg-surface-hover hover:text-text",
        danger: "border border-danger/25 bg-danger/10 text-danger hover:bg-danger/16",
        subtle: "bg-primary/10 text-primary-soft hover:bg-primary/16",
      },
      size: {
        sm: "h-8.5 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-5 text-[14px]",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
