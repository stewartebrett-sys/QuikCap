import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Capture from "./Capture";
import Database from "./Database";

const windowLabel = getCurrentWindow().label;

function App() {
  return windowLabel === "capture" ? <Capture /> : <Database />;
}

export default App;
