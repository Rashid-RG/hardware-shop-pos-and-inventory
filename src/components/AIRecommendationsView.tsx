import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  RefreshCcw,
  Zap,
  TrendingUp,
  AlertTriangle,
  Flame,
  Check,
  PlusCircle,
  FileCheck2,
} from 'lucide-react';
import { Product, Supplier } from '../types';

interface AIRecommendationsViewProps {
  products: Product[];
  suppliers: Supplier[];
  currentUser: string;
  onRefreshDb: () => void;
  onNavigateToTab: (tab: string) => void;
  authToken: string;
}

export default function AIRecommendationsView({
  products,
  suppliers,
  currentUser,
  onRefreshDb,
  onNavigateToTab,
  authToken,
}: AIRecommendationsViewProps) {
    const authFetch = (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {});
      headers.set('Authorization', `Bearer ${authToken}`);
      if (!headers.has('Content-Type') && init?.body) {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(url, { ...init, headers });
    };

  const [forecastMarkdown, setForecastMarkdown] = useState<string>('');
  const [isLoadingForecast, setIsLoadingForecast] = useState<boolean>(false);

  const [reorders, setReorders] = useState<any[]>([]);
  const [isLoadingReorders, setIsLoadingReorders] = useState<boolean>(false);

  const [sandboxActive, setSandboxActive] = useState<boolean>(false);
  const [errorWarning, setErrorWarning] = useState<string>('');

  // Status message for replenishment actions
  const [replenishSuccessMsg, setReplenishSuccessMsg] = useState<string>('');

  // Auto trigger predictions on landing
  useEffect(() => {
    handleLoadForecast();
    handleLoadSmartReorders();
  }, []);

  // Fetch forecast Markdown
  const handleLoadForecast = async () => {
    setIsLoadingForecast(true);
    setForecastMarkdown('');
    setErrorWarning('');
    try {
      const res = await authFetch('/api/ai/forecast', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.error === 'GEMINI_API_KEY_MISSING') {
        setSandboxActive(true);
      }
      setForecastMarkdown(data.aiMarkdownMarkdown);
    } catch (err: any) {
      setErrorWarning('Forecast API query timed out or failed. Check workspace key parameters.');
    } finally {
      setIsLoadingForecast(false);
    }
  };

  // Fetch standard reorder lists from Gemini structured JSON output
  const handleLoadSmartReorders = async () => {
    setIsLoadingReorders(true);
    setReorders([]);
    try {
      const res = await authFetch('/api/ai/reorder-suggestions', {
        method: 'POST',
      });
      const data = await res.json();
      setReorders(data.suggestions || []);
    } catch (err) {
      console.error('Failed to pull reorder advisor suggestions:', err);
    } finally {
      setIsLoadingReorders(false);
    }
  };

  // Simple Markdown-to-HTML parser to display prompt neatly without external deps
  const renderSimpleMarkdown = (mdText: string) => {
    if (!mdText) return <p className="text-slate-400">Loading forecast projection data...</p>;

    const lines = mdText.split('\n');
    return (
      <div className="space-y-4 text-xs font-sans text-slate-705 leading-relaxed antialiased">
        {lines.map((line, idx) => {
          const trimmed = line.trim();

          // Heading Match
          if (trimmed.startsWith('###')) {
            return (
              <h4 key={idx} className="font-heading font-semibold text-slate-900 text-sm mt-3.5 mb-1.5 flex items-center gap-1.5 border-b border-slate-100 pb-1">
                <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                {trimmed.replace('###', '').trim()}
              </h4>
            );
          }
          if (trimmed.startsWith('##') || trimmed.startsWith('#')) {
            return (
              <h3 key={idx} className="font-heading font-bold text-slate-950 text-base mt-4 mb-2 flex items-center gap-1.5 border-b border-slate-200 pb-1.5 uppercase tracking-wide">
                <Sparkles className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
                {trimmed.replace(/^#+/, '').trim()}
              </h3>
            );
          }

          // Bullet match
          if (trimmed.startsWith('*') || trimmed.startsWith('-')) {
            const rawContent = trimmed.replace(/^[\s*-]+/, '').trim();
            // Simple bold parser
            const parts = rawContent.split('**');
            return (
              <ul key={idx} className="list-disc pl-5 space-y-1 my-1">
                <li className="text-slate-700">
                  {parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="text-slate-950 font-semibold">{p}</strong> : p))}
                </li>
              </ul>
            );
          }

          // Plain paragraph
          if (trimmed) {
            const parts = trimmed.split('**');
            return (
              <p key={idx} className="text-slate-650 my-2">
                {parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="text-slate-950 font-medium">{p}</strong> : p))}
              </p>
            );
          }

          return <div key={idx} className="h-1" />;
        })}
      </div>
    );
  };

  // Restock PO auto spawning integration
  const handleAutoReplenish = async (rec: any) => {
    // Locate match product to acquire name & category
    const product = products.find((p) => p.id === rec.productId);
    if (!product) return;

    // Pick first supplier that fits or default titan
    let fitSup = suppliers[0];
    if (product.category === 'Plumbing') {
      fitSup = suppliers.find((s) => s.id === 'sup-2') || suppliers[0];
    } else if (product.category === 'Paints') {
      fitSup = suppliers.find((s) => s.id === 'sup-3') || suppliers[0];
    } else if (product.category === 'Construction Materials') {
      fitSup = suppliers.find((s) => s.id === 'sup-4') || suppliers[0];
    } else {
      fitSup = suppliers.find((s) => s.id === 'sup-1') || suppliers[0];
    }

    try {
      const response = await authFetch('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: fitSup.id,
          supplierName: fitSup.name,
          orderUser: currentUser,
          items: [
            {
              productId: product.id,
              productName: product.name,
              quantity: rec.suggestedQty || 30,
              costPrice: product.costPrice,
            },
          ],
        }),
      });

      if (response.ok) {
        setReplenishSuccessMsg(`Successfully spawned draft purchase order for "${product.name}" with ${fitSup.name}!`);
        onRefreshDb(); // Update PO state in parent
        setTimeout(() => setReplenishSuccessMsg(''), 5000);
      } else {
        alert('PO auto spawn failed');
      }
    } catch (err) {
      alert('Internal error spawning PO');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 motion-safe:animate-fade-in antialiased selection:bg-amber-100 font-sans">
      {/* Title line */}
      <div className="lg:col-span-12 bg-white p-6 rounded-xl border border-slate-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading font-medium tracking-tight text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            Predictive Business Intelligence Studio
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Powered by Gemini, parsing regional sales history to optimize inventory restocking levels automatically.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              handleLoadForecast();
              handleLoadSmartReorders();
            }}
            className="p-2.5 bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-800 rounded-lg text-xs font-bold font-sans hover:bg-slate-100 flex items-center gap-1.5 transition"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> Re-trigger Assessment
          </button>
        </div>
      </div>

      {/* API Key missing block */}
      {sandboxActive && (
        <div id="ai-key-warning-bar" className="lg:col-span-12 bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700 leading-relaxed">
            <p className="font-semibold text-slate-900 text-sm">Gemini AI Engine running in Advisory Sandbox mode</p>
            <p className="mt-1">
              No server-side <strong>GEMINI_API_KEY</strong> environment secret was detected in this container workspace.
              The application has automatically loaded simulated predictive analysis models. To activate live analysis over customized transactions, hook up an API key under <strong>Settings (top-right Secrets)</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Success banner notifications */}
      {replenishSuccessMsg && (
        <div id="replenish-po-success-notification" className="lg:col-span-12 bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-center justify-between font-sans text-xs">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-emerald-500" />
            <span>{replenishSuccessMsg}</span>
          </div>
          <button
            onClick={() => onNavigateToTab('purchases')}
            className="text-xs font-bold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded"
          >
            Go to Supplier PO Panel
          </button>
        </div>
      )}

      {/* LEFT COLUMN: SMART REORDER ADVISOR (5 cols) */}
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-xs space-y-4 flex flex-col justify-between min-h-[500px]">
          <div>
            <h4 className="font-heading font-medium text-slate-900 text-sm flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-amber-500" /> Stock Replenishment Advisor
            </h4>
            <p className="text-[11px] text-slate-400">
              Gemini-calculated recommendations for SKUs dropping beneath safety water levels.
            </p>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 flex-1 my-3">
            {isLoadingReorders ? (
              <div className="text-center py-16 text-slate-400 text-xs font-mono space-y-3">
                <div className="h-6 w-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p>Consulting historical depletion factors...</p>
              </div>
            ) : reorders.length > 0 ? (
              reorders.map((rec, i) => {
                const isCrit = rec.priority === 'CRITICAL';
                return (
                  <div
                    key={i}
                    id={`ai-suggestion-card-${i}`}
                    className="p-3 bg-slate-50 hover:bg-slate-100/50 rounded-xl border border-slate-150 transition space-y-3"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div>
                        <h5 className="font-sans font-bold text-slate-900 text-xs line-clamp-2">
                          {rec.name}
                        </h5>
                        <p className="text-[9px] font-mono text-slate-400 mt-0.5 uppercase">Product Suggestion</p>
                      </div>

                      <span
                        className={`px-2 py-0.5 text-[8px] font-mono font-bold uppercase rounded ${
                          isCrit ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {rec.priority}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600 font-mono leading-relaxed bg-white p-2 rounded border border-slate-100">
                      {rec.reason}
                    </p>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">Ideal batch buy:</span>
                        <strong className="font-mono text-slate-900">{rec.suggestedQty || 30} units</strong>
                      </div>

                      <button
                        id={`btn-spawn-po-sug-${i}`}
                        onClick={() => handleAutoReplenish(rec)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 leading-none shadow-3xs transition text-[10px]"
                      >
                        <PlusCircle className="w-3.5 h-3.5" /> Buy Draft PO
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-16 text-slate-400 border border-dashed border-slate-150 p-6 rounded-xl font-sans text-xs">
                <Check className="w-7 h-7 mx-auto text-emerald-500" />
                <p className="font-semibold mt-2">Inventory balance optimal</p>
                <p className="text-[10px] mt-1 text-slate-500">All warehouse stock buffers remain within secure safety targets.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: EXECUTIVE DEMAND FORECAST MARKDOWN REPORT (7 cols) */}
      <div className="lg:col-span-7 flex flex-col space-y-4">
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex-1 min-h-[500px]">
          <div className="border-b border-slate-100 pb-4 mb-4 flex items-center justify-between">
            <div>
              <h4 className="font-heading font-medium text-slate-900 text-sm flex items-center gap-1.5">
                <FileCheck2 className="w-4 h-4 text-emerald-500" /> Executive Demand Analysis
              </h4>
              <p className="text-[11px] text-slate-400">
                Seasonal trends, regional builder activity factors, and localized weather correlations.
              </p>
            </div>
            {sandboxActive && (
              <span className="bg-slate-100 text-slate-500 text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase">
                Advisory Mode
              </span>
            )}
          </div>

          <div id="ai-markdown-panel" className="bg-slate-50 p-5 rounded-2xl border border-slate-200 overflow-y-auto max-h-[530px] shadow-2xs">
            {isLoadingForecast ? (
              <div className="text-center py-32 text-slate-400 text-xs font-mono space-y-4">
                <div className="h-7 w-7 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="animate-pulse">Gemini intelligence model summarizing transaction records...</p>
              </div>
            ) : (
              renderSimpleMarkdown(forecastMarkdown)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
