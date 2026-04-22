import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import PipelinePage from "./pages/PipelinePage";
import DealProfilePage from "./pages/DealProfilePage";
import ChatPage from "./pages/ChatPage";
import ImportPage from "./pages/ImportPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="h-screen w-full font-sans bg-white">
        <Routes>
          {/* Main dashboard — has its own full-screen layout with inline sidebar */}
          <Route path="/" element={<HomePage />} />
          {/* Pipeline table — full screen with back button */}
          <Route path="/pipeline" element={<PipelinePage />} />
          {/* Individual deal profile */}
          <Route path="/pipeline/:id" element={<DealProfilePage />} />
          {/* Chat page */}
          <Route path="/chat" element={<ChatPage />} />
          {/* Import page */}
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
