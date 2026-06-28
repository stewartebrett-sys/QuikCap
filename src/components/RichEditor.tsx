import "./RichEditor.css";
import { useEffect, useImperativeHandle, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";

export interface RichEditorHandle {
  getHTML: () => string;
  getText: () => string;
  setContent: (html: string) => void;
  clear: () => void;
  focus: () => void;
}

interface Props {
  initialContent?: string;
  onChange?: (html: string) => void;
  onEscape?: () => void;
  onCtrlEnter?: (html: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { initialContent = "", onChange, onEscape, onCtrlEnter, disabled, autoFocus },
  ref
) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } }),
    ],
    content: initialContent,
    editable: !disabled,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: { class: "re-content", spellcheck: "false" },
      handleKeyDown(_, event) {
        if (event.key === "Escape") {
          onEscape?.();
          return true;
        }
        if (event.key === "Enter" && event.ctrlKey) {
          onCtrlEnter?.(editor?.getHTML() ?? "");
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      onChange?.(editor.getHTML());
    },
  });

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() ?? "",
    getText: () => editor?.getText() ?? "",
    setContent: (html) => editor?.commands.setContent(html),
    clear: () => editor?.commands.clearContent(true),
    focus: () => editor?.commands.focus("end"),
  }));

  // Keep editable in sync with disabled prop
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes("link").href ?? "";
    const url = window.prompt("URL", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <div className={`re-wrap${disabled ? " re-wrap--disabled" : ""}`}>
      {!disabled && (
        <div className="re-toolbar">
          <ToolBtn
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold (Ctrl+B)"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M4 2h4.5a3.5 3.5 0 0 1 2.2 6.18A3.5 3.5 0 0 1 8.5 14H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 5.5h3.5a1.5 1.5 0 0 0 0-3H5v3Zm0 4h3.5a1.5 1.5 0 0 0 0-3H5v3Z"/></svg>
          </ToolBtn>
          <ToolBtn
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic (Ctrl+I)"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M6 2h5v2H9.06L7.94 12H10v2H5v-2h1.94L8.06 4H6V2Z"/></svg>
          </ToolBtn>
          <ToolBtn
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline (Ctrl+U)"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M4 2v5a4 4 0 0 0 8 0V2h-2v5a2 2 0 0 1-4 0V2H4Zm-1 11h10v1H3v-1Z"/></svg>
          </ToolBtn>

          <div className="re-sep" />

          <ToolBtn
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet list"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="2.5" cy="4.5" r="1.5"/><rect x="5" y="4" width="9" height="1"/><circle cx="2.5" cy="8.5" r="1.5"/><rect x="5" y="8" width="9" height="1"/><circle cx="2.5" cy="12.5" r="1.5"/><rect x="5" y="12" width="9" height="1"/></svg>
          </ToolBtn>
          <ToolBtn
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered list"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><text x="1" y="5.5" fontSize="5" fontFamily="monospace">1.</text><rect x="5" y="4" width="9" height="1"/><text x="1" y="9.5" fontSize="5" fontFamily="monospace">2.</text><rect x="5" y="8" width="9" height="1"/><text x="1" y="13.5" fontSize="5" fontFamily="monospace">3.</text><rect x="5" y="12" width="9" height="1"/></svg>
          </ToolBtn>
          <ToolBtn
            active={editor.isActive("taskList")}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            title="Checklist"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="3" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1" fill="none"/><path d="M2 5l1.2 1.2L5 3.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/><rect x="7" y="4" width="7" height="1" rx="0.5"/><rect x="1" y="9" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1" fill="none"/><rect x="7" y="10" width="7" height="1" rx="0.5"/></svg>
          </ToolBtn>

          <div className="re-sep" />

          <ToolBtn
            active={editor.isActive("highlight")}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            title="Highlight"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M9.5 2 13 5.5 6.5 12H3V8.5L9.5 2Z" opacity="0.7"/><path d="M9.5 2 13 5.5l-1.5 1.5L8.5 5.5 9.5 2Z" opacity="1"/><rect x="1" y="13.5" width="14" height="1" rx="0.5"/></svg>
          </ToolBtn>
          <ToolBtn
            active={editor.isActive("link")}
            onClick={setLink}
            title="Link"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l1.5-1.5a3.5 3.5 0 0 0-4.95-4.95L6.86 4.18a.5.5 0 1 0 .71.71l1.14-1.13a2.5 2.5 0 1 1 3.53 3.53l-1.5 1.5a2.5 2.5 0 0 1-3.53 0 .5.5 0 0 0-.71.71ZM9.5 6.5a3.5 3.5 0 0 0-4.95 0L3.05 8a3.5 3.5 0 0 0 4.95 4.95l1.14-1.14a.5.5 0 1 0-.71-.71L7.29 12.24a2.5 2.5 0 1 1-3.53-3.53l1.5-1.5a2.5 2.5 0 0 1 3.53 0 .5.5 0 0 0 .71-.71Z"/></svg>
          </ToolBtn>
        </div>
      )}
      <EditorContent editor={editor} className="re-editor-wrap" />
    </div>
  );
});

function ToolBtn({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className={`re-btn${active ? " re-btn--active" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor focus
        onClick();
      }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

export default RichEditor;
