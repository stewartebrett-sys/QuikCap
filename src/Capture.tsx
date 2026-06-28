import "./Capture.css";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ExtUnderline from "@tiptap/extension-underline";   // aliased — clashes with Lucide
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { Table as ExtTable } from "@tiptap/extension-table"; // aliased — clashes with Lucide
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import ExtImage from "@tiptap/extension-image";             // aliased — clashes with Lucide
import Placeholder from "@tiptap/extension-placeholder";
import {
  Undo2, Redo2,
  Bold, Italic, Underline, Strikethrough,
  Palette, Highlighter, Eraser,
  List, ListOrdered, ListChecks,
  AlignLeft, AlignCenter, AlignRight,
  Outdent, Indent,
  Table, Link2, Image, Minus,
  Flag, Pin,
  MoreHorizontal,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────

type SaveStatus = "saved" | "saving";

const DRAFT_DEBOUNCE_MS = 400;
const MIN_ZOOM = 80;
const MAX_ZOOM = 160;
const ZOOM_STEP = 5;

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

// ─── Capture ─────────────────────────────────────────────

function Capture() {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [followUp, setFollowUp] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [zoom, setZoom] = useState(100);

  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorInstanceRef = useRef<Editor | null>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const appWindow = getCurrentWindow();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      ExtUnderline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      ExtTable.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      ExtImage.configure({ inline: false }),
      Placeholder.configure({ placeholder: "Capture a thought…" }),
    ],
    autofocus: "end",
    editorProps: {
      attributes: { class: "cap-prose", spellcheck: "false" },
      handleKeyDown(_, event) {
        const e = editorInstanceRef.current;

        // Ctrl+Enter → finish note
        if (event.key === "Enter" && event.ctrlKey) {
          if (!e) return false;
          const html = e.getHTML();
          if (!html.replace(/<[^>]*>/g, "").trim()) return true;
          e.commands.clearContent(true);
          clearTimeout(draftTimer.current);
          invoke("finish_note", { text: html }).catch(console.error);
          invoke("hide_capture").catch(console.error);
          return true;
        }

        // Ctrl+K → link dialog
        if (event.key === "k" && event.ctrlKey && !event.shiftKey) {
          event.preventDefault();
          if (!e) return true;
          const prev = (e.getAttributes("link") as { href?: string }).href ?? "";
          const url = window.prompt("URL", prev);
          if (url !== null) {
            if (url === "") e.chain().focus().unsetLink().run();
            else e.chain().focus().setLink({ href: url }).run();
          }
          return true;
        }

        // Ctrl+Shift+V → paste as plain text
        if (event.key === "v" && event.ctrlKey && event.shiftKey) {
          event.preventDefault();
          navigator.clipboard
            .readText()
            .then((text) => e?.commands.insertContent(text))
            .catch(() => {});
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
  useEffect(() => { editorInstanceRef.current = editor; }, [editor]);

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

  // Re-focus when the global hotkey re-opens the window
  useEffect(() => {
    const p = listen("focus-editor", () => editor?.commands.focus("end"));
    return () => { p.then((u) => u()); };
  }, [editor]);

  // Escape → hide (capture phase fires before Tiptap)
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

  // Ctrl+Wheel → zoom editor text only (not the whole UI)
  useEffect(() => {
    const el = editorAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((prev) =>
        Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)))
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
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
            <button className="cap-winctrl cap-winctrl--min" onClick={() => appWindow.minimize()} title="Minimize">
              <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" rx="0.5" fill="currentColor" /></svg>
            </button>
            <button className="cap-winctrl cap-winctrl--max" onClick={() => appWindow.toggleMaximize()} title="Maximize">
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" /></svg>
            </button>
            <button className="cap-winctrl cap-winctrl--close" onClick={() => appWindow.hide()} title="Close (Esc)">
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
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

      {/* ── Editor — zoom applied as CSS variable so only text scales ── */}
      <div
        ref={editorAreaRef}
        className="cap-editor-area"
        style={{ "--editor-zoom": String(zoom / 100) } as React.CSSProperties}
      >
        <EditorContent editor={editor} className="cap-editor-mount" />
      </div>

      {/* ── Status bar ── */}
      <footer className="cap-status">
        <div className="cap-status-left">
          <span className={`cap-save-dot${saveStatus === "saved" ? " cap-save-dot--green" : ""}`} />
          <span className="cap-save-label">{saveStatus === "saved" ? "Saved" : "Saving…"}</span>
        </div>
        <div className="cap-status-center">
          Press <kbd className="cap-kbd">Esc</kbd> to close
          &nbsp;·&nbsp;
          <kbd className="cap-kbd">Ctrl+↵</kbd> to finish note
        </div>
        <div className="cap-status-right">
          {zoom !== 100 && <span className="cap-status-zoom">{zoom}%</span>}
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

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (colorWrapRef.current && !colorWrapRef.current.contains(e.target as Node))
        setShowColors(false);
      if (overflowWrapRef.current && !overflowWrapRef.current.contains(e.target as Node))
        setShowOverflow(false);
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

  const ICON = 16; // consistent icon size throughout toolbar

  return (
    <div className="cap-toolbar" role="toolbar" aria-label="Formatting options">

      {/* Editing */}
      <TBtn title="Undo (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={ICON} />
      </TBtn>
      <TBtn title="Redo (Ctrl+Y)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={ICON} />
      </TBtn>

      <TbrSep />

      {/* Text */}
      <TBtn title="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={ICON} />
      </TBtn>
      <TBtn title="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={ICON} />
      </TBtn>
      <TBtn title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline size={ICON} />
      </TBtn>
      <TBtn title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={ICON} />
      </TBtn>

      {/* Text color with color-indicator bar */}
      <div className="tbr-pop-wrap" ref={colorWrapRef}>
        <TBtn title="Text color" active={showColors || !!currentColor} onClick={() => setShowColors((v) => !v)}>
          <ColorIcon color={currentColor || "#111827"} size={ICON} />
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
        <Highlighter size={ICON} />
      </TBtn>
      <TBtn title="Clear formatting" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
        <Eraser size={ICON} />
      </TBtn>

      <TbrSep />

      {/* Lists */}
      <TBtn title="Bullet list (Ctrl+Shift+8)" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={ICON} />
      </TBtn>
      <TBtn title="Numbered list (Ctrl+Shift+7)" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={ICON} />
      </TBtn>
      <TBtn title="Checklist" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks size={ICON} />
      </TBtn>

      <TbrSep />

      {/* Paragraph */}
      <TBtn title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft size={ICON} />
      </TBtn>
      <TBtn title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter size={ICON} />
      </TBtn>
      <TBtn title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight size={ICON} />
      </TBtn>
      <TBtn title="Outdent" disabled={!editor.can().liftListItem("listItem")} onClick={() => editor.chain().focus().liftListItem("listItem").run()}>
        <Outdent size={ICON} />
      </TBtn>
      <TBtn title="Indent" disabled={!editor.can().sinkListItem("listItem")} onClick={() => editor.chain().focus().sinkListItem("listItem").run()}>
        <Indent size={ICON} />
      </TBtn>

      <TbrSep />

      {/* Insert */}
      <TBtn title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table size={ICON} />
      </TBtn>
      <TBtn title="Link (Ctrl+K)" active={editor.isActive("link")} onClick={applyLink}>
        <Link2 size={ICON} />
      </TBtn>
      <TBtn title="Insert image" onClick={applyImage}>
        <Image size={ICON} />
      </TBtn>
      <TBtn title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus size={ICON} />
      </TBtn>

      <TbrSep />

      {/* Organization */}
      <TBtn title="Follow up" active={followUp} onClick={onFollowUp}>
        <Flag size={ICON} className={followUp ? "tbr-icon--flag-active" : ""} />
      </TBtn>
      <TBtn title="Pin note" active={pinned} onClick={onPin}>
        <Pin size={ICON} />
      </TBtn>

      <TbrSep />

      {/* Overflow */}
      <div className="tbr-pop-wrap" ref={overflowWrapRef}>
        <TBtn title="More options" active={showOverflow} onClick={() => setShowOverflow((v) => !v)}>
          <MoreHorizontal size={ICON} />
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

function OverflowBtn({ children, active, onSelect }: { children: React.ReactNode; active?: boolean; onSelect: () => void }) {
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

// ─── Color icon: Palette glyph + colored underline bar ───

function ColorIcon({ color, size }: { color: string; size: number }) {
  return (
    <span className="tbr-color-icon">
      <Palette size={size} />
      <span className="tbr-color-icon-bar" style={{ background: color }} />
    </span>
  );
}

export default Capture;
