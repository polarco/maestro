import { Fragment, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { ContextMenu, DropdownMenu } from "radix-ui";
import { cn } from "@renderer/lib/utils";

export interface ActionMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void | Promise<void>;
}

function MenuEntries({
  items,
  kind,
}: {
  items: readonly ActionMenuItem[];
  kind: "dropdown" | "context";
}) {
  const Item = kind === "dropdown" ? DropdownMenu.Item : ContextMenu.Item;
  const Separator = kind === "dropdown" ? DropdownMenu.Separator : ContextMenu.Separator;
  return items.map((item) => {
    const Icon = item.icon;
    return (
      <Fragment key={item.id}>
        {item.separatorBefore ? <Separator className="action-menu-separator" /> : null}
        <Item
          className={cn("action-menu-item", item.danger && "action-menu-item-danger")}
          {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
          onSelect={() => void Promise.resolve(item.onSelect()).catch(() => {})}
        >
          <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
            {Icon ? <Icon size={14} strokeWidth={1.8} /> : null}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.shortcut ? <kbd className="action-menu-shortcut">{item.shortcut}</kbd> : null}
        </Item>
      </Fragment>
    );
  });
}

export function ActionDropdown({
  trigger,
  items,
  label,
  align = "start",
}: {
  trigger: ReactElement;
  items: readonly ActionMenuItem[];
  label: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="action-menu-content"
          sideOffset={6}
          align={align}
          collisionPadding={10}
          aria-label={label}
        >
          <MenuEntries items={items} kind="dropdown" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ActionContextMenu({
  children,
  items,
  label,
}: {
  children: ReactElement;
  items: readonly ActionMenuItem[];
  label: string;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="action-menu-content"
          collisionPadding={10}
          aria-label={label}
        >
          <MenuEntries items={items} kind="context" />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
