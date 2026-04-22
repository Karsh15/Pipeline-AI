"use client";

import { useState } from "react";
import { Send, Bot, User, Database } from "lucide-react";

export default function ChatPage() {
  const [messages, setMessages] = useState([
    { role: "ai", content: "Hello! I am your Deal Pipeline AI. I've ingested all active deals, underwriting models, and PDFs. Ask me anything to query your portfolio." }
  ]);
  const [input, setInput] = useState("");

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setMessages([...messages, { role: "user", content: input }]);
    setInput("");

    // Mock AI response
    setTimeout(() => {
      setMessages(prev => [...prev, { role: "ai", content: "Based on the recent models, 'Sunrise Hotel Plaza' has the highest NOI margin at 34%, compared to the portfolio average of 28%. Would you like me to generate a comparison table?" }]);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] animate-in fade-in duration-500">
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight">AI Portfolio Assistant</h2>
        <p className="text-muted-foreground mt-1">Cross-deal semantic search powered by Pinecone & RAG.</p>
      </div>

      <div className="flex-1 bg-card rounded-2xl border border-border shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border bg-secondary/30 flex items-center gap-3">
          <Database className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Vector Database: Connected (1,204 Documents Indexed)</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-4 max-w-3xl ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
              <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center ${msg.role === 'ai' ? 'bg-primary/10 text-primary' : 'bg-secondary text-foreground'}`}>
                {msg.role === 'ai' ? <Bot className="h-5 w-5" /> : <User className="h-5 w-5" />}
              </div>
              <div className={`rounded-2xl px-5 py-3.5 text-sm ${
                msg.role === 'ai' 
                  ? 'bg-secondary text-foreground border border-border' 
                  : 'bg-primary text-white shadow-sm'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 bg-card border-t border-border">
          <form onSubmit={handleSend} className="relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g., 'Compare NOI across all hospitality deals in Miami'"
              className="w-full rounded-full border border-border bg-secondary/50 px-6 py-4 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
            />
            <button
              type="submit"
              className="absolute right-2 top-2 p-2 bg-primary text-white rounded-full hover:bg-primary/90 transition-colors"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
