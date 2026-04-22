import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Component, type ErrorInfo, type ReactNode } from "react";
import HomePage from "./pages/HomePage";
import PipelinePage from "./pages/PipelinePage";
import ChatPage from "./pages/ChatPage";
import ImportPage from "./pages/ImportPage";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center text-2xl">⚠</div>
          <h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground max-w-sm">{(this.state.error as Error).message}</p>
          <button onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors">
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="h-screen w-full font-sans bg-white">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/import" element={<ImportPage />} />
          </Routes>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
