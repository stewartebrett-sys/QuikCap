/**
 * ColorPickerPopover — shared color picker used by both the main
 * formatting toolbar and the floating selection toolbar.
 *
 * Supports two modes:
 *   "text"      → sets/unsets text color via the Color extension
 *   "highlight" → sets/unsets highlight color (requires multicolor: true)
 *
 * Renders as `position: absolute` so the CALLER wraps it in a
 * `position: relative` container.
 */

import "./ColorPickerPopover.css";
import type { Editor } from "@tiptap/react";

// ─── Text color palette ────────────────────────────────────

export const PRESET_COLORS = [
  { hex: "#000000", label: "Black"  },
  { hex: "#6b7280", label: "Gray"   },
  { hex: "#dc2626", label: "Red"    },
  { hex: "#ea580c", label: "Orange" },
  { hex: "#16a34a", label: "Green"  },
  { hex: "#2563eb", label: "Blue"   },
  { hex: "#7c3aed", label: "Purple" },
];

// ─── Highlight palette (light background tones) ────────────

export const HIGHLIGHT_COLORS = [
  { hex: "#fef08a", label: "Yellow"  },
  { hex: "#bbf7d0", label: "Green"   },
  { hex: "#bfdbfe", label: "Blue"    },
  { hex: "#fecaca", label: "Red"     },
  { hex: "#e9d5ff", label: "Purple"  },
  { hex: "#fed7aa", label: "Orange"  },
  { hex: "#f1f5f9", label: "Gray"    },
];

// ─── Helpers ───────────────────────────────────────────────

export function getActiveColor(editor: Editor): string {
  return (editor.getAttributes("textStyle") as { color?: string }).color ?? "";
}

export function getActiveHighlight(editor: Editor): string {
  return (editor.getAttributes("highlight") as { color?: string }).color ?? "";
}

// ─── Component ─────────────────────────────────────────────

export interface ColorPickerPopoverProps {
  editor:   Editor;
  onClose:  () => void;
  mode?:    "text" | "highlight";
}

export function ColorPickerPopover({ editor, onClose, mode = "text" }: ColorPickerPopoverProps) {
  const isHighlight = mode === "highlight";
  const palette     = isHighlight ? HIGHLIGHT_COLORS : PRESET_COLORS;
  const activeColor = isHighlight ? getActiveHighlight(editor) : getActiveColor(editor);

  const apply = (hex: string) => {
    if (isHighlight) {
      editor.chain().focus().setHighlight({ color: hex }).run();
    } else {
      editor.chain().focus().setColor(hex).run();
    }
    onClose();
  };

  const reset = () => {
    if (isHighlight) {
      editor.chain().focus().unsetHighlight().run();
    } else {
      editor.chain().focus().unsetColor().run();
    }
    onClose();
  };

  return (
    <div className="color-pop">
      <div className="color-pop-grid">
        {palette.map(({ hex, label }) => (
          <button
            key={hex}
            className={`color-swatch${activeColor === hex ? " color-swatch--on" : ""}`}
            style={{ background: hex }}
            title={label}
            onMouseDown={e => { e.preventDefault(); apply(hex); }}
          />
        ))}
      </div>
      <button
        className="color-pop-reset"
        onMouseDown={e => { e.preventDefault(); reset(); }}
      >
        {isHighlight ? "No highlight" : "Reset color"}
      </button>
    </div>
  );
}
