import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import WorkspaceHistory from "./pages/WorkspaceHistory";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/workspace/:path" element={<WorkspaceHistory />} />
    </Routes>
  );
}

export default App;
