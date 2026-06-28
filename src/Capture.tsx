import "./Capture.css";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";

// ─── Types ───────────────────────────────────────────────

type SaveStatus = "saved" | "saving";

const DRAFT_DEBOUNCE_MS = 400;

const PRESET_COLORS = [
  { hex: "#000000", label: "Black" },
  { hex: "#374151", label: "Dark gray" },
  { hex: "#6b7280", label: "Gray" },
  { hex: "#dc2626", label: "Red" },
  { hex: "#ea580c", label: "Orange" },
  { hex: "#d97706", label: "Amber" },
  { hex: "#16a34a", label: "Green" },
  { hex: "#2563eb", label: "Blue" },
  { hex: "#7c3aed", label: "Purple" },
  { hex: "#db2777", label: "Pink" },
];

function getWordCount(editor: Editor | null): number {
  if (!editor) return 0;
  const text = editor.getText().trim();
  return text ? text.split(/\s+/).length : 0;
}

// ─── Main Component ───────────────────────────────────────

function Capture() {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [followUp, setFollowUp] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorInstanceRef = useRef<Editor | null>(null);
  const appWindow = getCurrentWindow();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: "Start typing…" }),
    ],
    autofocus: "end",
    editorProps: {
      attributes: { class: "cap-prose", spellcheck: "false" },
      handleKeyDown(_, event) {
        if (event.key === "Enter" && event.ctrlKey) {
          const e = editorInstanceRef.current;
          if (!e) return false;
          const html = e.getHTML();
          if (!html.replace(/<[^>]*>/g, "").trim()) return true;
          e.commands.clearContent(true);
          clearTimeout(draftTimer.current);
          invoke("finish_note", { text: html }).catch(console.error);
          invoke("hide_capture").catch(console.error);
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: e }) {
      setWordCount(getWordCount(e));
      setSaveStatus("saving");
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        invoke("save_draft", { text: e.getHTML() }).catch(console.error);
        setSaveStatus("saved");
      }, DRAFT_DEBOUNCE_MS);
    },
  });

  // Keep ref in sync so handleKeyDown closure always sees the live editor
  useEffect(() => {
    editorInstanceRef.current = editor;
  }, [editor]);

  // Load persisted draft
  useEffect(() => {
    if (!editor) return;
    invoke<string>("load_draft").then((draft) => {
      if (draft) {
        editor.commands.setContent(draft);
        setWordCount(getWordCount(editor));
      }
    });
  }, [editor]);

  // Refocus when the hotkey re-opens the window
  useEffect(() => {
    const p = listen("focus-editor", () => editor?.commands.focus("end"));
    return () => { p.then((u) => u()); };
  }, [editor]);

  // Escape → hide (capture phase so it fires before Tiptap)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        invoke("hide_capture").catch(console.error);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const handleFinish = () => {
    const html = editor?.getHTML() ?? "";
    if (!html.replace(/<[^>]*>/g, "").trim()) return;
    editor?.commands.clearContent(true);
    clearTimeout(draftTimer.current);
    invoke("finish_note", { text: html }).catch(console.error);
    invoke("hide_capture").catch(console.error);
  };

  return (
    <div className="cap-root">
      {/* ── Header ── */}
      <header className="cap-header" data-tauri-drag-region>
        <div className="cap-logo" data-tauri-no-drag>
          <svg className="cap-logo-icon" width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M9 1L2 9.5H7.5L7 15L14 6.5H8.5L9 1Z" fill="#7c3aed" strokeLinejoin="round" />
          </svg>
          <span className="cap-logo-text">QuikCap</span>
        </div>

        <div className="cap-header-actions" data-tauri-no-drag>
          <button className="cap-finish-btn" onClick={handleFinish}>
            Finish Note
          </button>
          <div className="cap-winctrl-group">
            <button
              className="cap-winctrl cap-winctrl--min"
              onClick={() => appWindow.minimize()}
              title="Minimize"
            >
              <svg width="10" height="1" viewBox="0 0 10 1">
                <rect width="10" height="1" rx="0.5" fill="currentColor" />
              </svg>
            </button>
            <button
              className="cap-winctrl cap-winctrl--max"
              onClick={() => appWindow.toggleMaximize()}
              title="Maximize"
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                <rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
              </svg>
            </button>
            <button
              className="cap-winctrl cap-winctrl--close"
              onClick={() => appWindow.hide()}
              title="Close (Esc)"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Toolbar ── */}
      {editor && (
        <CaptureToolbar
          editor={editor}
          followUp={followUp}
          onFollowUp={() => setFollowUp((v) => !v)}
          pinned={pinned}
          onPin={() => setPinned((v) => !v)}
        />
      )}

      {/* ── Editor ── */}
      <div className="cap-editor-area">
        <EditorContent editor={editor} className="cap-editor-mount" />
      </div>

      {/* ── Status bar ── */}
      <footer className="cap-status">
        <div className="cap-status-left">
          <span
            className={`cap-save-dot${saveStatus === "saved" ? " cap-save-dot--green" : ""}`}
          />
          <span className="cap-save-label">
            {saveStatus === "saved" ? "Saved" : "Saving…"}
          </span>
        </div>
        <div className="cap-status-center">
          Press <kbd className="cap-kbd">Esc</kbd> to close
          &nbsp;·&nbsp;
          <kbd className="cap-kbd">Ctrl+↵</kbd> to finish note
        </div>
        <div className="cap-status-right">
          {wordCount} {wordCount === 1 ? "word" : "words"}
        </div>
      </footer>
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────

interface ToolbarProps {
  editor: Editor;
  followUp: boolean;
  onFollowUp: () => void;
  pinned: boolean;
  onPin: () => void;
}

function CaptureToolbar({ editor, followUp, onFollowUp, pinned, onPin }: ToolbarProps) {
  const [showColors, setShowColors] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const colorWrapRef = useRef<HTMLDivElement>(null);
  const overflowWrapRef = useRef<HTMLDivElement>(null);
  const currentColor = (editor.getAttributes("textStyle") as { color?: string }).color ?? "";

  // Close any open popover when clicking outside
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (colorWrapRef.current && !colorWrapRef.current.contains(e.target as Node)) {
        setShowColors(false);
      }
      if (overflowWrapRef.current && !overflowWrapRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const applyLink = () => {
    const prev = (editor.getAttributes("link") as { href?: string }).href ?? "";
    const url = window.prompt("URL", prev);
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  };

  const applyImage = () => {
    const url = window.prompt("Image URL");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  return (
    <div className="cap-toolbar" role="toolbar" aria-label="Formatting options">

      {/* ── Editing ── */}
      <TBtn title="Undo (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <IconUndo />
      </TBtn>
      <TBtn title="Redo (Ctrl+Y)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <IconRedo />
      </TBtn>

      <TbrSep />

      {/* ── Text ── */}
      <TBtn title="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <IconBold />
      </TBtn>
      <TBtn title="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <IconItalic />
      </TBtn>
      <TBtn title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <IconUnderline />
      </TBtn>
      <TBtn title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <IconStrike />
      </TBtn>

      {/* Text Color */}
      <div className="tbr-pop-wrap" ref={colorWrapRef}>
        <TBtn
          title="Text color"
          active={showColors || !!currentColor}
          onClick={() => setShowColors((v) => !v)}
        >
          <IconColor color={currentColor || "#111827"} />
        </TBtn>
        {showColors && (
          <div className="tbr-color-pop">
            <div className="tbr-color-grid">
              {PRESET_COLORS.map(({ hex, label }) => (
                <button
                  key={hex}
                  className={`tbr-color-swatch${currentColor === hex ? " tbr-color-swatch--active" : ""}`}
                  style={{ background: hex }}
                  title={label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    editor.chain().focus().setColor(hex).run();
                    setShowColors(false);
                  }}
                />
              ))}
            </div>
            <button
              className="tbr-color-reset"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().unsetColor().run();
                setShowColors(false);
              }}
            >
              Reset color
            </button>
          </div>
        )}
      </div>

      <TBtn title="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <IconHighlight />
      </TBtn>
      <TBtn title="Clear formatting" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
        <IconClearFormat />
      </TBtn>

      <TbrSep />

      {/* ── Lists ── */}
      <TBtn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <IconBulletList />
      </TBtn>
      <TBtn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <IconOrderedList />
      </TBtn>
      <TBtn title="Checklist" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <IconChecklist />
      </TBtn>

      <TbrSep />

      {/* ── Paragraph ── */}
      <TBtn title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <IconAlignLeft />
      </TBtn>
      <TBtn title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <IconAlignCenter />
      </TBtn>
      <TBtn title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <IconAlignRight />
      </TBtn>
      <TBtn
        title="Outdent"
        onClick={() => editor.chain().focus().liftListItem("listItem").run()}
        disabled={!editor.can().liftListItem("listItem")}
      >
        <IconOutdent />
      </TBtn>
      <TBtn
        title="Indent"
        onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
        disabled={!editor.can().sinkListItem("listItem")}
      >
        <IconIndent />
      </TBtn>

      <TbrSep />

      {/* ── Insert ── */}
      <TBtn title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <IconTable />
      </TBtn>
      <TBtn title="Insert link" active={editor.isActive("link")} onClick={applyLink}>
        <IconLink />
      </TBtn>
      <TBtn title="Insert image" onClick={applyImage}>
        <IconImage />
      </TBtn>
      <TBtn title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <IconHR />
      </TBtn>

      <TbrSep />

      {/* ── Organization ── */}
      <TBtn title="Follow up" active={followUp} onClick={onFollowUp}>
        <IconFlag active={followUp} />
      </TBtn>
      <TBtn title="Pin note" active={pinned} onClick={onPin}>
        <IconPin active={pinned} />
      </TBtn>

      <TbrSep />

      {/* ── Overflow ── */}
      <div className="tbr-pop-wrap" ref={overflowWrapRef}>
        <TBtn title="More options" active={showOverflow} onClick={() => setShowOverflow((v) => !v)}>
          <IconOverflow />
        </TBtn>
        {showOverflow && (
          <div className="tbr-overflow-pop">
            <OverflowSection label="Headings">
              <OverflowBtn active={editor.isActive("heading", { level: 1 })} onSelect={() => { editor.chain().focus().toggleHeading({ level: 1 }).run(); setShowOverflow(false); }}>Heading 1</OverflowBtn>
              <OverflowBtn active={editor.isActive("heading", { level: 2 })} onSelect={() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); setShowOverflow(false); }}>Heading 2</OverflowBtn>
              <OverflowBtn active={editor.isActive("heading", { level: 3 })} onSelect={() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); setShowOverflow(false); }}>Heading 3</OverflowBtn>
              <OverflowBtn active={editor.isActive("paragraph")} onSelect={() => { editor.chain().focus().setParagraph().run(); setShowOverflow(false); }}>Normal text</OverflowBtn>
            </OverflowSection>
            <div className="tbr-overflow-divider" />
            <OverflowSection label="Block">
              <OverflowBtn active={editor.isActive("blockquote")} onSelect={() => { editor.chain().focus().toggleBlockquote().run(); setShowOverflow(false); }}>Blockquote</OverflowBtn>
              <OverflowBtn active={editor.isActive("code")} onSelect={() => { editor.chain().focus().toggleCode().run(); setShowOverflow(false); }}>Inline code</OverflowBtn>
            </OverflowSection>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Toolbar primitives ───────────────────────────────────

function TBtn({
  children,
  active,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tbr-btn${active ? " tbr-btn--active" : ""}${disabled ? " tbr-btn--dim" : ""}`}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick?.(); }}
      title={title}
      aria-pressed={active}
      aria-label={title}
    >
      {children}
    </button>
  );
}

function TbrSep() {
  return <div className="tbr-sep" aria-hidden />;
}

function OverflowSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tbr-overflow-section">
      <div className="tbr-overflow-label">{label}</div>
      {children}
    </div>
  );
}

function OverflowBtn({
  children,
  active,
  onSelect,
}: {
  children: React.ReactNode;
  active?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`tbr-overflow-item${active ? " tbr-overflow-item--active" : ""}`}
      onMouseDown={(e) => { e.preventDefault(); onSelect(); }}
    >
      {children}
    </button>
  );
}

// ─── SVG Icons ────────────────────────────────────────────

const S = ({ children }: { children: React.ReactNode }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    {children}
  </svg>
);

const IconUndo = () => (
  <S>
    <path d="M3.5 6.5H9a4 4 0 0 1 0 8H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.5 3.5L1 6.5L3.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);

const IconRedo = () => (
  <S>
    <path d="M12.5 6.5H7a4 4 0 0 0 0 8H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12.5 3.5L15 6.5L12.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);

const IconBold = () => (
  <S>
    <path d="M4 2h4.5a3 3 0 0 1 1.9 5.3A3.5 3.5 0 0 1 8.5 14H4V2z" fill="currentColor" />
    <path d="M4 8h4a1.5 1.5 0 0 0 0-3H4v3zm0 4.5h4.5a1.5 1.5 0 0 0 0-3H4v3z" fill="var(--cap-bg, #fff)" />
  </S>
);

const IconItalic = () => (
  <S>
    <path d="M7 2h5M4 14h5M9.5 2L6.5 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </S>
);

const IconUnderline = () => (
  <S>
    <path d="M4 2v5a4 4 0 0 0 8 0V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M2 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </S>
);

const IconStrike = () => (
  <S>
    <path d="M5 10a3 3 0 0 0 3 3 3 3 0 0 0 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5 6a3 3 0 0 1 3-2 3 3 0 0 1 3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M2 8.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconColor = ({ color }: { color: string }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <text x="3" y="11" fontSize="10" fontWeight="700" fontFamily="system-ui, sans-serif" fill="currentColor">A</text>
    <rect x="2" y="13" width="12" height="2" rx="1" fill={color} />
  </svg>
);

const IconHighlight = () => (
  <S>
    <rect x="1" y="11" width="14" height="3" rx="1" fill="#fde68a" />
    <path d="M5 10L8 2l3 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.2 7.5h3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </S>
);

const IconClearFormat = () => (
  <S>
    <path d="M4 2h8M7 2v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M11 10L14 13M14 10L11 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M4 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconBulletList = () => (
  <S>
    <circle cx="3" cy="4.5" r="1.2" fill="currentColor" />
    <circle cx="3" cy="8.5" r="1.2" fill="currentColor" />
    <circle cx="3" cy="12.5" r="1.2" fill="currentColor" />
    <path d="M6.5 4.5h7M6.5 8.5h7M6.5 12.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconOrderedList = () => (
  <S>
    <path d="M2 3h1.5v5M2 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 11c0-1 2-1 2 0s-2 1-2 2h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 4.5h7M7 8.5h7M7 12.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconChecklist = () => (
  <S>
    <rect x="1.5" y="2.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <path d="M2.8 5l1.2 1.2L6 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <path d="M8.5 5h6M8.5 12h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconAlignLeft = () => (
  <S>
    <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconAlignCenter = () => (
  <S>
    <path d="M2 4h12M4 8h8M3 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconAlignRight = () => (
  <S>
    <path d="M2 4h12M6 8h8M4 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconOutdent = () => (
  <S>
    <path d="M5 4h9M5 8h9M5 12h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M4 6L1 8l3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);

const IconIndent = () => (
  <S>
    <path d="M5 4h9M5 8h9M5 12h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M1 6L4 8l-3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);

const IconTable = () => (
  <S>
    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <path d="M1.5 5.5h13M6 5.5V14.5" stroke="currentColor" strokeWidth="1.2" />
  </S>
);

const IconLink = () => (
  <S>
    <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l1.5-1.5a3.5 3.5 0 0 0-4.95-4.95l-.88.88" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0L3.05 8a3.5 3.5 0 0 0 4.95 4.95l.88-.88" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </S>
);

const IconImage = () => (
  <S>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <circle cx="5.5" cy="6" r="1.5" fill="currentColor" />
    <path d="M1.5 11L5 7.5l3 3 2.5-2.5L14 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </S>
);

const IconHR = () => (
  <S>
    <path d="M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M2 4h4M10 4h4M2 12h4M10 12h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 1" opacity="0.4" />
  </S>
);

const IconFlag = ({ active }: { active: boolean }) => (
  <S>
    <path
      d="M4 2v12M4 2h8l-2 4 2 4H4"
      stroke={active ? "#dc2626" : "currentColor"}
      fill={active ? "#dc262620" : "none"}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </S>
);

const IconPin = ({ active }: { active: boolean }) => (
  <S>
    <path
      d="M9 2l5 5-3.5 1-3 3.5-1.5-1.5L8.5 6.5 7 5M2 14l4-4"
      stroke={active ? "#7c3aed" : "currentColor"}
      fill={active ? "#7c3aed20" : "none"}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </S>
);

const IconOverflow = () => (
  <S>
    <circle cx="4" cy="8" r="1.3" fill="currentColor" />
    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    <circle cx="12" cy="8" r="1.3" fill="currentColor" />
  </S>
);

export default Capture;
