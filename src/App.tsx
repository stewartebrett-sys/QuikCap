import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Capture from "./Capture";
import Database from "./Database";

function App() {
  // Evaluated at render time, not module load, so Tauri internals are ready.
  const windowLabel = getCurrentWindow().label;
  return windowLabel === "capture" ? <Capture /> : <Database />;
}

export default App;
