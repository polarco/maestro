import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Mention, type MentionNodeAttrs } from "@tiptap/extension-mention";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import type { WorkspaceContextCandidate } from "@maestro/contracts";

export interface ComposerEditorHandle {
  focus: () => void;
}

interface ComposerEditorProps {
  value: string;
  placeholder: string;
  disabled?: boolean;
  searchWorkspace: (query: string) => Promise<WorkspaceContextCandidate[]>;
  onMention: (candidate: WorkspaceContextCandidate) => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPasteFiles: (files: File[]) => void;
}

function documentFromText(value: string): JSONContent {
  return {
    type: "doc",
    content: value.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

function suggestionMenu(
  searchWorkspace: (query: string) => Promise<WorkspaceContextCandidate[]>,
  onMention: (candidate: WorkspaceContextCandidate) => void,
): Omit<SuggestionOptions<WorkspaceContextCandidate, MentionNodeAttrs>, "editor"> {
  const candidates = new Map<string, WorkspaceContextCandidate>();
  return {
    char: "@",
    debounce: 80,
    items: async ({ query, signal }) => {
      const items = await searchWorkspace(query);
      items.forEach((item) => candidates.set(item.id, item));
      return signal.aborted ? [] : items;
    },
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "mention", attrs: { id: props.id, label: props.label } },
          { type: "text", text: " " },
        ])
        .run();
      const candidate = props.id ? candidates.get(props.id) : null;
      if (candidate) onMention(candidate);
    },
    render: () => {
      let root: HTMLDivElement | null = null;
      let unmount: (() => void) | null = null;
      let selected = 0;
      let current: SuggestionProps<WorkspaceContextCandidate, MentionNodeAttrs> | null = null;

      const choose = (index: number) => {
        const item = current?.items[index];
        if (item) current?.command({ id: item.id, label: item.name });
      };

      const paint = () => {
        if (!root || !current) return;
        selected = Math.min(selected, Math.max(0, current.items.length - 1));
        root.replaceChildren();
        if (current.loading) {
          const loading = document.createElement("div");
          loading.className = "mention-menu-empty";
          loading.textContent = "Buscando no projeto…";
          root.append(loading);
        } else if (current.items.length === 0) {
          const empty = document.createElement("div");
          empty.className = "mention-menu-empty";
          empty.textContent = current.query
            ? "Nenhum item encontrado"
            : "Digite para buscar arquivos";
          root.append(empty);
        }
        current.items.forEach((item, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `mention-menu-item${index === selected ? " is-selected" : ""}`;
          button.setAttribute("role", "option");
          button.setAttribute("aria-selected", String(index === selected));

          const heading = document.createElement("span");
          heading.className = "mention-menu-name";
          heading.textContent = `${item.kind === "directory" ? "▸" : "·"} ${item.name}`;
          const path = document.createElement("span");
          path.className = "mention-menu-path";
          path.textContent = `${item.rootName} / ${item.relativePath}`;
          button.append(heading, path);
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
            choose(index);
          });
          button.addEventListener("mousemove", () => {
            if (selected !== index) {
              selected = index;
              paint();
            }
          });
          root?.append(button);
        });
      };

      const update = (props: SuggestionProps<WorkspaceContextCandidate, MentionNodeAttrs>) => {
        current = props;
        selected = 0;
        paint();
      };

      return {
        onStart: (props) => {
          root = document.createElement("div");
          root.className = "mention-menu";
          root.setAttribute("role", "listbox");
          update(props);
          unmount = props.mount(root);
        },
        onUpdate: update,
        onKeyDown: ({ event }: SuggestionKeyDownProps) => {
          if (!current) return false;
          if (event.key === "ArrowDown") {
            selected = (selected + 1) % Math.max(1, current.items.length);
            paint();
            return true;
          }
          if (event.key === "ArrowUp") {
            selected =
              (selected - 1 + Math.max(1, current.items.length)) %
              Math.max(1, current.items.length);
            paint();
            return true;
          }
          if (event.key === "Enter" && current.items.length > 0) {
            choose(selected);
            return true;
          }
          return event.key === "Escape";
        },
        onExit: () => {
          unmount?.();
          unmount = null;
          root = null;
          current = null;
        },
      };
    },
  };
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor(
    {
      value,
      placeholder,
      disabled = false,
      searchWorkspace,
      onMention,
      onChange,
      onSubmit,
      onPasteFiles,
    },
    ref,
  ) {
    const changeRef = useRef(onChange);
    const submitRef = useRef(onSubmit);
    const pasteRef = useRef(onPasteFiles);
    changeRef.current = onChange;
    submitRef.current = onSubmit;
    pasteRef.current = onPasteFiles;

    const extensions = useMemo(
      () => [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          dropcursor: false,
          gapcursor: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          trailingNode: false,
          underline: false,
        }),
        Mention.configure({
          HTMLAttributes: { class: "composer-mention" },
          renderText: ({ node }) => `@${String(node.attrs.label ?? node.attrs.id ?? "item")}`,
          renderHTML: ({ node }) => [
            "span",
            { class: "composer-mention" },
            `@${String(node.attrs.label ?? node.attrs.id ?? "item")}`,
          ],
          suggestion: suggestionMenu(searchWorkspace, onMention),
        }),
      ],
      [onMention, searchWorkspace],
    );

    const editor = useEditor({
      extensions,
      content: documentFromText(value),
      editable: !disabled,
      editorProps: {
        attributes: {
          class: "composer-editor-content",
          "aria-label": "Mensagem",
          placeholder,
        },
        handleKeyDown: (view, event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.isComposing ||
            view.composing ||
            event.keyCode === 229
          )
            return false;
          event.preventDefault();
          submitRef.current();
          return true;
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          pasteRef.current(files);
          return true;
        },
      },
      onUpdate: ({ editor: current }) => {
        changeRef.current(current.getText({ blockSeparator: "\n" }));
      },
    });

    useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus() }), [editor]);

    useEffect(() => {
      editor?.setEditable(!disabled);
    }, [disabled, editor]);

    useEffect(() => {
      if (!editor) return;
      const current = editor.getText({ blockSeparator: "\n" });
      if (current !== value)
        editor.commands.setContent(documentFromText(value), { emitUpdate: false });
    }, [editor, value]);

    return (
      <div className="composer-editor-shell">
        {!value ? <span className="composer-editor-placeholder">{placeholder}</span> : null}
        <EditorContent editor={editor} />
      </div>
    );
  },
);
