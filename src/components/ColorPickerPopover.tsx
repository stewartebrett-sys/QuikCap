/**
 * ColorPickerPopover — shared color picker.
 * "text" mode → sets/unsets text color via the Color extension.
 * "highlight" mode → sets/unsets highlight (requires multicolor: true).
 */

import "./ColorPickerPopover.css";
import type { Editor } from "@tiptap/react";

// ─── Text color palette (20 colors, 5-column grid) ─────────
// Matches Office's standard color palette: neutrals + warm + cool + other.

export const PRESET_COLORS = [
  // Row 1 — Neutrals
  { hex: "#000000", label: "Black"      },
  { hex: "#404040", label: "Dark Gray"  },
  { hex: "#808080", label: "Gray"       },
  { hex: "#bfbfbf", label: "Light Gray" },
  { hex: "#ffffff", label: "White"      },
  // Row 2 — Warm
  { hex: "#c00000", label: "Dark Red"   },
  { hex: "#ff0000", label: "Red"        },
  { hex: "#ff6600", label: "Orange"     },
  { hex: "#ffc000", label: "Gold"       },
  { hex: "#ffff00", label: "Yellow"     },
  // Row 3 — Cool
  { hex: "#006100", label: "Dark Green" },
  { hex: "#00b050", label: "Green"      },
  { hex: "#008080", label: "Teal"       },
  { hex: "#0070c0", label: "Blue"       },
  { hex: "#002060", label: "Dark Blue"  },
  // Row 4 — Other
  { hex: "#7030a0", label: "Purple"     },
  { hex: "#e6007e", label: "Pink"       },
  { hex: "#4472c4", label: "Cornflower" },
  { hex: "#843c0c", label: "Brown"      },
  { hex: "#c9211e", label: "Crimson"    },
];

// ─── Highlight palette (15 colors, 5-column grid) ──────────
// Microsoft Word's exact highlight color palette.

export const HIGHLIGHT_COLORS = [
  // Row 1
  { hex: "#ffff00", label: "Yellow"      },
  { hex: "#00ff00", label: "Bright Green"},
  { hex: "#00ffff", label: "Turquoise"   },
  { hex: "#ff00ff", label: "Pink"        },
  { hex: "#0000ff", label: "Blue"        },
  // Row 2
  { hex: "#ff0000", label: "Red"         },
  { hex: "#000080", label: "Dark Blue"   },
  { hex: "#008080", label: "Teal"        },
  { hex: "#008000", label: "Green"       },
  { hex: "#800080", label: "Purple"      },
  // Row 3
  { hex: "#800000", label: "Dark Red"    },
  { hex: "#808000", label: "Dark Yellow" },
  { hex: "#808080", label: "Gray 50%"    },
  { hex: "#c0c0c0", label: "Gray 25%"    },
  { hex: "#000000", label: "Black"       },
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
  editor:    Editor;
  onClose:   () => void;
  mode?:     "text" | "highlight";
  onSelect?: (color: string) => void;
}

export function ColorPickerPopover({ editor, onClose, mode = "text", onSelect }: ColorPickerPopoverProps) {
  const isHighlight = mode === "highlight";
  const palette     = isHighlight ? HIGHLIGHT_COLORS : PRESET_COLORS;
  const activeColor = isHighlight ? getActiveHighlight(editor) : getActiveColor(editor);

  const apply = (hex: string) => {
    if (isHighlight) {
      editor.chain().focus().setHighlight({ color: hex }).run();
    } else {
      editor.chain().focus().setColor(hex).run();
    }
    onSelect?.(hex);
    onClose();
  };

  const reset = () => {
    if (isHighlight) editor.chain().focus().unsetHighlight().run();
    else             editor.chain().focus().unsetColor().run();
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
