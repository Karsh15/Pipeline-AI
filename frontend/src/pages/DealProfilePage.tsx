import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Building, Home, CheckCircle2, FileText, Activity } from "lucide-react";
import { mockDeals, formatCurrency } from "@/lib/mockData";

export default function DealProfilePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const deal = mockDeals.find(d => d.id === id) || mockDeals[0];
  const [activeTab, setActiveTab] = useState("ai-summary");

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Pipeline
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">{deal.name}</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center"><MapPin className="mr-1 h-3.5 w-3.5" /> {deal.address}</span>
              <span className="flex items-center"><Building className="mr-1 h-3.5 w-3.5" /> {deal.assetType}</span>
              <span className="flex items-center"><Home className="mr-1 h-3.5 w-3.5" /> {deal.units} Units</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-sm font-medium ring-1 ring-inset ${
              deal.status === "LOI" ? "bg-orange-50 text-orange-700 ring-orange-600/20" :
              deal.status === "Underwriting" ? "bg-blue-50 text-blue-700 ring-blue-600/20" :
              "bg-gray-50 text-gray-700 ring-gray-600/20"
            }`}>
              {deal.status}
            </span>
            <button className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors">
              Advance Deal
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
              <div className="text-sm font-medium text-muted-foreground">Guidance Price</div>
              <div className="text-xl font-bold mt-1">{formatCurrency(deal.guidancePrice)}</div>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
              <div className="text-sm font-medium text-muted-foreground">Year Built</div>
              <div className="text-xl font-bold mt-1">{deal.yearBuilt}</div>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
              <div className="text-sm font-medium text-muted-foreground">Est. Value (AI)</div>
              <div className="text-xl font-bold mt-1 text-primary">{formatCurrency(deal.guidancePrice * 0.92)}</div>
            </div>
          </div>

          <div className="border-b border-border">
            <nav className="-mb-px flex space-x-8">
              {[
                { id: "ai-summary", name: "AI Investment Summary" },
                { id: "financials", name: "Financial Model" },
                { id: "dd-questions", name: "Extracted DD Questions" },
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                  }`}>
                  {tab.name}
                </button>
              ))}
            </nav>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm p-6 min-h-[400px]">
            {activeTab === "ai-summary" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-3">AI Executive Summary</h3>
                  <p className="text-sm text-foreground leading-relaxed">
                    Based on the broker OM and trailing 12-month financials, {deal.name} presents a stable {deal.assetType} opportunity.
                    The property has maintained a 92% occupancy rate despite comparable submarket softness. AI analysis flags a potential
                    value-add opportunity by bringing expense ratios (currently 42%) down to the market standard of 38%.
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3">Investment Criteria Matrix</h3>
                  <div className="border rounded-xl overflow-hidden">
                    <table className="min-w-full divide-y divide-border text-sm">
                      <thead className="bg-secondary/50">
                        <tr>
                          {["Criteria", "Target", "Actual", "Status"].map(h => (
                            <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-4 py-3">NOI Margin</td>
                          <td className="px-4 py-3">&gt; 35%</td>
                          <td className="px-4 py-3 font-semibold">31.2%</td>
                          <td className="px-4 py-3 text-red-600 font-medium text-xs">FAIL</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-3">Vintage</td>
                          <td className="px-4 py-3">Post-2005</td>
                          <td className="px-4 py-3 font-semibold">{deal.yearBuilt}</td>
                          <td className="px-4 py-3 text-green-600 font-medium text-xs">PASS</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {activeTab !== "ai-summary" && (
              <div className="flex flex-col items-center justify-center h-full text-center py-20 text-muted-foreground">
                <Activity className="h-10 w-10 mb-4 opacity-50" />
                <p>Select another tab to view detailed extracted data.</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <h3 className="font-semibold mb-4 text-foreground">AI Agents Status</h3>
            <ul className="space-y-3">
              {[
                { name: "Metadata Extractor", status: "Complete", time: "12s ago" },
                { name: "Financial Scraper", status: "Complete", time: "14s ago" },
                { name: "Investment Summary", status: "Complete", time: "22s ago" },
                { name: "Risk Detection", status: "Processing", time: "..." },
              ].map((agent, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {agent.status === "Complete"
                      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                      : <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />}
                    <span className={agent.status === "Complete" ? "text-foreground" : "text-muted-foreground"}>{agent.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{agent.time}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <h3 className="font-semibold mb-4 text-foreground flex items-center justify-between">
              Source Documents
              <button className="text-xs text-primary font-medium">Add +</button>
            </h3>
            <ul className="space-y-2">
              {["Offering_Mem_2026.pdf", "T12_Financials.xlsx", "Rent_Roll.csv"].map((file, i) => (
                <li key={i} className="flex items-center gap-3 p-2 hover:bg-secondary/50 rounded-lg cursor-pointer transition-colors text-sm">
                  <div className="bg-primary/10 text-primary p-2 rounded-lg">
                    <FileText className="h-4 w-4" />
                  </div>
                  <span className="truncate">{file}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
