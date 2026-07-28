import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@renderer/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-[10px] border border-border bg-bg-elevated px-3.5 text-[13px] text-text outline-none transition-[border-color,box-shadow,background-color] placeholder:text-text-faint focus:border-primary/65 focus:bg-surface focus:ring-2 focus:ring-primary/10 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none rounded-[12px] border border-border bg-bg-elevated px-3.5 py-3 text-[13.5px] leading-5 text-text outline-none transition-[border-color,box-shadow,background-color] placeholder:text-text-faint focus:border-primary/65 focus:bg-surface focus:ring-2 focus:ring-primary/10 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-10 rounded-[10px] border border-border bg-bg-elevated px-3 text-[12px] text-text outline-none transition-[border-color,box-shadow,background-color] focus:border-primary/65 focus:bg-surface focus:ring-2 focus:ring-primary/10 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";

export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-[12px] font-semibold text-text-muted">
      {children}
    </label>
  );
}
