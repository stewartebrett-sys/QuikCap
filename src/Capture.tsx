import "./Capture.css";
import { FloatingToolbar } from "./components/FloatingToolbar";
import { IndentExt } from "./components/IndentExtension";
import { EditorToolbar, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from "./components/EditorToolbar";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ExtUnderline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { Table as ExtTable } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import ExtImage from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Pin, CalendarCheck,
  ChevronLeft, ChevronRight,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────

type SaveStatus = "saved" | "saving";

const DRAFT_DEBOUNCE_MS = 400;

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatFollowUpDisplay(date: Date): string {
  const now = new Date();
  if (date.getFullYear() !== now.getFullYear()) {
    return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ─── Capture ─────────────────────────────────────────────

function Capture() {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [followUpDate, setFollowUpDate] = useState<Date | null>(null);
  const [pinned, setPinned] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showCalendar, setShowCalendar] = useState(false);

  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorInstanceRef = useRef<Editor | null>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  // Allows handleKeyDown (closed over at useEditor init) to always call the
  // latest finishNote closure without stale-capture issues.
  const finishNoteRef = useRef<() => void>(() => {});

  const appWindow = getCurrentWindow();

  // Close calendar when clicking outside the header popover wrapper
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (calendarWrapRef.current && !calendarWrapRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

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
      IndentExt,
    ],
    autofocus: "end",
    editorProps: {
      attributes: { class: "cap-prose", spellcheck: "false" },
      handleKeyDown(_, event) {
        const e = editorInstanceRef.current;

        // Ctrl+Enter → finish note (delegates to always-current ref)
        if (event.key === "Enter" && event.ctrlKey) {
          finishNoteRef.current();
          return true;
        }

        // Backspace at the very start of an indented paragraph/heading → outdent.
        // Handled here (view-level, highest priority) rather than in addKeyboardShortcuts
        // so it always fires before ProseMirror's baseKeymap Backspace handler.
        if (event.key === "Backspace" && e) {
          const { state } = e;
          const { $from, empty } = state.selection;
          if (empty && $from.parentOffset === 0) {
            const parent = $from.parent;
            if (parent.type.name === "paragraph" || parent.type.name === "heading") {
              const indent = ((parent.attrs.indent as number) ?? 0);
              if (indent > 0) {
                event.preventDefault();
                // $from.before($from.depth) = position of the block's opening token
                const nodePos = $from.before($from.depth);
                e.view.dispatch(
                  state.tr.setNodeMarkup(nodePos, undefined, {
                    ...parent.attrs,
                    indent: indent - 1,
                  })
                );
                return true;
              }
            }
          }
        }

        // Undo: Ctrl+Z (Windows/Linux) and Cmd+Z (Mac).
        // Also accepts Ctrl+Z on Mac so the same muscle memory works cross-platform.
        if (event.key === "z" && !event.shiftKey && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          e?.chain().focus().undo().run();
          return true;
        }

        // Redo: Ctrl+Shift+Z / Cmd+Shift+Z, and Ctrl+Y (Windows convention).
        if (
          (event.key === "z" && event.shiftKey && (event.ctrlKey || event.metaKey)) ||
          (event.key === "y" && event.ctrlKey && !event.shiftKey)
        ) {
          event.preventDefault();
          e?.chain().focus().redo().run();
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
      const html = e.getHTML();
      // Don't save an empty document — happens when clearContent fires during finish
      if (!html.replace(/<[^>]*>/g, "").trim()) {
        setSaveStatus("saved");
        return;
      }
      setSaveStatus("saving");
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        invoke("save_draft", { text: html }).catch(console.error);
        setSaveStatus("saved");
      }, DRAFT_DEBOUNCE_MS);
    },
  });

  // Keep editor ref in sync so handleKeyDown closure always sees the live editor
  useEffect(() => { editorInstanceRef.current = editor; }, [editor]);

  // Load persisted draft
  useEffect(() => {
    if (!editor) return;
    invoke<string>("load_draft").then((draft) => {
      if (draft) editor.commands.setContent(draft);
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

  // ── Unified finish-note action ────────────────────────────
  // Called by both the Finish Note button and Ctrl+Enter.
  // Empty note → just hide. Non-empty → save + clear + hide.
  const finishNote = () => {
    const e = editorInstanceRef.current;
    const html = e?.getHTML() ?? "";
    const isEmpty = !html.replace(/<[^>]*>/g, "").trim();

    if (!isEmpty && e) {
      e.commands.clearContent(true);
      clearTimeout(draftTimer.current);
      invoke("finish_note", {
        text: html,
        followUpDate: followUpDate ? toISODate(followUpDate) : null,
        pinned,
      }).catch(console.error);
      setFollowUpDate(null);
      setPinned(false);
    }

    invoke("hide_capture").catch(console.error);
  };

  // Keep the ref pointing to the current closure on every render
  finishNoteRef.current = finishNote;

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
          {/* Pin */}
          <button
            className={`cap-hdr-btn${pinned ? " cap-hdr-btn--active" : ""}`}
            onClick={() => setPinned((v) => !v)}
            title={pinned ? "Unpin note" : "Pin note"}
          >
            <Pin size={13} strokeWidth={2} />
            Pin
          </button>

          {/* Follow Up + calendar popover */}
          <div className="cap-hdr-pop-wrap" ref={calendarWrapRef}>
            <button
              className={`cap-hdr-btn${(followUpDate !== null || showCalendar) ? " cap-hdr-btn--active" : ""}`}
              onClick={() => setShowCalendar((v) => !v)}
              title="Set follow-up date"
            >
              <CalendarCheck size={13} strokeWidth={2} />
              Follow Up
            </button>
            {followUpDate && (
              <span className="cap-hdr-followup-chip">{formatFollowUpDisplay(followUpDate)}</span>
            )}
            {showCalendar && (
              <CalendarPicker
                selected={followUpDate}
                onSelect={setFollowUpDate}
                onClose={() => setShowCalendar(false)}
              />
            )}
          </div>

          {/* Finish Note */}
          <button className="cap-finish-btn" onClick={finishNote}>
            Finish Note
          </button>

          {/* Window controls */}
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
        <EditorToolbar
          editor={editor}
          zoom={zoom}
          onZoomChange={setZoom}
          className="cap-toolbar"
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

      {/* Floating selection toolbar — rendered via portal, no layout impact */}
      <FloatingToolbar editor={editor} />

      {/* ── Status bar ── */}
      <footer className="cap-status">
        <div className="cap-status-left">
          <span className={`cap-save-dot${saveStatus === "saved" ? " cap-save-dot--green" : ""}`} />
          <span className="cap-save-label">{saveStatus === "saved" ? "Saved" : "Saving…"}</span>
        </div>
        <div className="cap-status-center">
          Press <kbd className="cap-kbd">Esc</kbd> to close
          &nbsp;·&nbsp;
          <kbd className="cap-kbd">Ctrl + Enter</kbd> to finish note
        </div>
        {/* Right spacer keeps center text visually centered */}
        <div className="cap-status-right" />
      </footer>
    </div>
  );
}

// ─── Calendar picker ─────────────────────────────────────

interface CalendarPickerProps {
  selected: Date | null;
  onSelect: (date: Date | null) => void;
  onClose: () => void;
}

function CalendarPicker({ selected, onSelect, onClose }: CalendarPickerProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const isToday = (d: number) =>
    today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d;

  const isSelected = (d: number) =>
    !!selected &&
    selected.getFullYear() === viewYear &&
    selected.getMonth() === viewMonth &&
    selected.getDate() === d;

  const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="cal-pop">
      <div className="cal-header">
        <button
          className="cal-nav"
          onMouseDown={(e) => { e.preventDefault(); prevMonth(); }}
          title="Previous month"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        <span className="cal-title">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button
          className="cal-nav"
          onMouseDown={(e) => { e.preventDefault(); nextMonth(); }}
          title="Next month"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="cal-grid">
        {DAY_LABELS.map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <div key={`e-${i}`} className="cal-empty" />
          ) : (
            <button
              key={`d-${i}`}
              className={[
                "cal-day",
                isToday(d) ? "cal-day--today" : "",
                isSelected(d) ? "cal-day--selected" : "",
              ].filter(Boolean).join(" ")}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(new Date(viewYear, viewMonth, d));
                onClose();
              }}
            >
              {d}
            </button>
          )
        )}
      </div>

      {selected && (
        <div className="cal-footer">
          <button
            className="cal-clear"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(null);
              onClose();
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

export default Capture;
