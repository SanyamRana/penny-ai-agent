import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { 
  DollarSign, 
  Activity, 
  Terminal, 
  Settings, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  PlusCircle, 
  Send,
  CreditCard,
  User,
  AlertCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Cell 
} from 'recharts';

const BACKEND_URL = 'http://localhost:5001';

interface Transaction {
  _id: string;
  merchantRaw: string;
  amount: number;
  location: string;
  timestamp: string;
  status: 'PENDING_CLASSIFICATION' | 'APPROVED' | 'PENDING_REVIEW' | 'BLOCKED';
  category: string;
  notes?: string;
  anomalyReason?: string;
  vectorMatchedMerchant?: string;
  vectorMatchedCategory?: string;
}

interface Budget {
  category: string;
  limit: number;
  spent: number;
  transactionCount: number;
}

interface AgentLog {
  transactionId: string;
  message: string;
  timestamp: string;
}

export default function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [overallLimit, setOverallLimit] = useState(0);
  const [overallSpent, setOverallSpent] = useState(0);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  // Transaction simulation form state
  const [simMerchant, setSimMerchant] = useState('Starbucks Coffee');
  const [simAmount, setSimAmount] = useState('6.80');
  const [simLocation, setSimLocation] = useState('New York, USA');

  // Human-in-the-loop modal state
  const [pendingAnomaly, setPendingAnomaly] = useState<{
    transactionId: string;
    amount: number;
    merchant: string;
    reason: string;
  } | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<any>(null);

  // Connect WebSockets
  useEffect(() => {
    socketRef.current = io(BACKEND_URL);

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to Penny Backend WebSockets');
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
    });

    // Listen for agent's real-time thoughts
    socketRef.current.on('agent-thought', (log: AgentLog) => {
      setAgentLogs(prev => [...prev, log]);
      // Refetch data since something happened
      fetchDashboardData();
    });

    // Listen for human-in-the-loop anomaly detection
    socketRef.current.on('anomaly-detected', (data: any) => {
      setPendingAnomaly(data);
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  // Initial fetch and auto scroll logs
  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [agentLogs]);

  const fetchDashboardData = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/dashboard`);
      const data = await response.json();
      if (data) {
        setTransactions(data.transactions || []);
        setBudgets(data.budgets || []);
        setOverallLimit(data.overallLimit || 0);
        setOverallSpent(data.overallSpent || 0);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  // Seed demo data
  const handleSetupDemo = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/setup-demo`, { method: 'POST' });
      const result = await res.json();
      setAgentLogs([{
        transactionId: 'system',
        message: `🔄 Demo Environment Reset: Seeded ${result.budgetsSeeded} budgets, ${result.merchantsSeeded} vector search templates, and initial transactions.`,
        timestamp: new Date().toISOString()
      }]);
      fetchDashboardData();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSeeding(false);
    }
  };

  // Simulate transaction trigger
  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simMerchant || !simAmount) return;
    setIsSimulating(true);

    try {
      await fetch(`${BACKEND_URL}/api/simulate-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantRaw: simMerchant,
          amount: simAmount,
          location: simLocation
        })
      });
      // Clear or reset fields optionally
    } catch (error) {
      console.error(error);
    } finally {
      setIsSimulating(false);
    }
  };

  // Handle preset selections
  const applyPreset = (merchant: string, amount: string, location: string) => {
    setSimMerchant(merchant);
    setSimAmount(amount);
    setSimLocation(location);
  };

  // Human-in-the-loop action response
  const handleAnomalyResponse = async (approved: boolean) => {
    if (!pendingAnomaly) return;
    try {
      await fetch(`${BACKEND_URL}/api/verify-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: pendingAnomaly.transactionId,
          approved
        })
      });
      setPendingAnomaly(null);
      fetchDashboardData();
    } catch (error) {
      console.error(error);
    }
  };

  // Helper to color badge status
  const getStatusBadge = (status: Transaction['status']) => {
    switch (status) {
      case 'APPROVED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 w-max"><CheckCircle size={12}/> Approved</span>;
      case 'PENDING_REVIEW':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 w-max"><AlertTriangle size={12}/> Review Required</span>;
      case 'BLOCKED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 w-max"><XCircle size={12}/> Blocked</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center gap-1 w-max animate-pulse"><Activity size={12}/> Processing</span>;
    }
  };

  return (
    <div className="min-h-screen text-slate-100 p-4 lg:p-8 flex flex-col gap-6 relative">
      {/* Background Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none"></div>

      {/* TOP HEADER */}
      <header className="glass-card p-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 pulse-primary">
            <CreditCard className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent">Penny</h1>
            <p className="text-xs text-slate-400">MongoDB-Driven Live Agentic Personal Finance Broker</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Connection Status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
            <span className="text-slate-300">{isConnected ? 'System Live' : 'System Offline'}</span>
          </div>

          {/* Seed Button */}
          <button 
            onClick={handleSetupDemo}
            disabled={isSeeding}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white flex items-center gap-2 border border-indigo-400/20 transition-all cursor-pointer"
          >
            <RefreshCw size={14} className={isSeeding ? 'animate-spin' : ''} />
            Reset & Seed Demo Data
          </button>
        </div>
      </header>

      {/* DASHBOARD METRICS */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Overall Monthly Budget</p>
            <h3 className="text-3xl font-bold mt-1 text-white">${overallLimit.toFixed(2)}</h3>
          </div>
          <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
            <DollarSign size={24} />
          </div>
        </div>

        <div className="glass-card p-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Monthly Spent</p>
            <h3 className="text-3xl font-bold mt-1 text-white">${overallSpent.toFixed(2)}</h3>
            <p className="text-xs mt-1 text-slate-400">
              {overallLimit > 0 ? `${((overallSpent / overallLimit) * 100).toFixed(1)}% of total budget` : 'No budget set'}
            </p>
          </div>
          <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
            <Activity size={24} />
          </div>
        </div>

        <div className="glass-card p-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Agent</p>
            <h3 className="text-lg font-bold mt-1 text-emerald-400 flex items-center gap-1.5">
              <CheckCircle size={18} className="animate-pulse" />
              Penny (Gemini-2.5-Flash)
            </h3>
            <p className="text-xs text-slate-400 mt-1">Listening to MongoDB Change Streams</p>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Terminal size={24} />
          </div>
        </div>
      </section>

      {/* CORE SECTIONS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 1. TRANSACTION SIMULATOR */}
        <div className="glass-card p-6 flex flex-col gap-5 lg:col-span-1">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <PlusCircle className="text-indigo-400" size={20} />
              Simulate Purchase
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Injects a transaction document directly to fire the Change Stream</p>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-slate-500 uppercase">Interactive Presets</p>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => applyPreset('Starbucks Coffee', '6.80', 'New York, USA')}
                className="p-2 text-left text-xs bg-slate-900/60 hover:bg-indigo-950/40 border border-white/5 hover:border-indigo-500/30 rounded-lg transition-all"
              >
                ☕ Starbucks ($6.80)
                <span className="block text-[10px] text-slate-400">Standard Grocery</span>
              </button>
              <button 
                onClick={() => applyPreset('Uber Ride London', '24.50', 'London, UK')}
                className="p-2 text-left text-xs bg-slate-900/60 hover:bg-indigo-950/40 border border-white/5 hover:border-indigo-500/30 rounded-lg transition-all"
              >
                🚕 Uber Ride ($24.50)
                <span className="block text-[10px] text-slate-400">Standard Travel</span>
              </button>
              <button 
                onClick={() => applyPreset('Emirates Airlines', '350.00', 'London, UK')}
                className="p-2 text-left text-xs bg-slate-900/60 hover:bg-indigo-950/40 border border-white/5 hover:border-indigo-500/30 rounded-lg transition-all"
              >
                ✈️ Fly Emirates ($350.00)
                <span className="block text-[10px] text-amber-400">Triggers Over-Budget</span>
              </button>
              <button 
                onClick={() => applyPreset('Apple Store Regent St', '850.00', 'London, UK')}
                className="p-2 text-left text-xs bg-slate-900/60 hover:bg-rose-950/40 border border-white/5 hover:border-rose-500/30 rounded-lg transition-all"
              >
                💻 Apple Store ($850.00)
                <span className="block text-[10px] text-rose-400">High-Value Anomaly</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSimulate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Raw Merchant Text</label>
              <input 
                type="text" 
                value={simMerchant} 
                onChange={(e) => setSimMerchant(e.target.value)}
                placeholder="e.g. Starbucks Cafe London"
                className="w-full bg-slate-950/60 border border-white/10 focus:border-indigo-500 rounded-lg px-3.5 py-2 text-sm focus:outline-none transition-all"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Amount ($)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={simAmount} 
                  onChange={(e) => setSimAmount(e.target.value)}
                  placeholder="24.50"
                  className="w-full bg-slate-950/60 border border-white/10 focus:border-indigo-500 rounded-lg px-3.5 py-2 text-sm focus:outline-none transition-all"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Location</label>
                <input 
                  type="text" 
                  value={simLocation} 
                  onChange={(e) => setSimLocation(e.target.value)}
                  placeholder="London, UK"
                  className="w-full bg-slate-950/60 border border-white/10 focus:border-indigo-500 rounded-lg px-3.5 py-2 text-sm focus:outline-none transition-all"
                  required
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isSimulating}
              className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-semibold text-sm border border-indigo-400/20 shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
            >
              <Send size={14} />
              {isSimulating ? 'Simulating...' : 'Simulate Transaction'}
            </button>
          </form>
        </div>

        {/* 2. REAL-TIME REASONING TERMINAL */}
        <div className="glass-card p-6 flex flex-col gap-4 lg:col-span-2">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Terminal className="text-purple-400" size={20} />
                Live Agent Reasoning
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Real-time log of Gemini's thought chain, vector matches, and tool executions</p>
            </div>
            <button 
              onClick={() => setAgentLogs([])}
              className="px-2.5 py-1 text-[10px] font-semibold bg-slate-900 border border-white/5 hover:border-white/10 text-slate-400 hover:text-white rounded-md transition-all"
            >
              Clear Log
            </button>
          </div>

          <div className="flex-1 bg-slate-950/90 border border-white/10 rounded-xl p-4 overflow-y-auto min-h-[300px] max-h-[300px] flex flex-col gap-2 font-mono text-xs shadow-inner">
            {agentLogs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-center gap-2">
                <Terminal size={32} className="animate-pulse" />
                <p>Waiting for transaction events...</p>
                <p className="text-[10px]">Use the simulator on the left to inject a transaction</p>
              </div>
            ) : (
              agentLogs.map((log, index) => {
                let color = 'text-slate-300';
                if (log.message.includes('✅')) color = 'text-emerald-400 border-emerald-500/20';
                else if (log.message.includes('🚨') || log.message.includes('❌')) color = 'text-rose-400 border-rose-500/20';
                else if (log.message.includes('🛠️') || log.message.includes('⚙️')) color = 'text-indigo-400 border-indigo-500/20';
                else if (log.message.includes('🛎️') || log.message.includes('🔥')) color = 'text-white border-white/20';
                else if (log.message.includes('📊')) color = 'text-amber-400 border-amber-500/20';
                else if (log.message.includes('🧠')) color = 'text-purple-400 border-purple-500/20';

                return (
                  <div key={index} className={`terminal-line ${color} border-l-2 bg-slate-900/40 rounded-r py-1 px-2.5 animate-slide-in`}>
                    <span className="text-[10px] text-slate-600 mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    {log.message}
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

      </div>

      {/* MID SECTION: BUDGETS & CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* BUDGET PROGRESS LIST */}
        <div className="glass-card p-6 flex flex-col gap-5 lg:col-span-1">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Settings className="text-indigo-400" size={20} />
              Category Budgets
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Monthly limits vs. actual spending from MongoDB Aggregations</p>
          </div>

          <div className="flex flex-col gap-4">
            {budgets.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No budget structures. Reset demo data to seed.</p>
            ) : (
              budgets.map((b, idx) => {
                const pct = Math.min((b.spent / b.limit) * 100, 100);
                const isOver = b.spent > b.limit;
                
                return (
                  <div key={idx} className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-300">{b.category}</span>
                      <span className={isOver ? 'text-rose-400' : 'text-slate-400'}>
                        ${b.spent.toFixed(2)} / ${b.limit}
                      </span>
                    </div>
                    {/* Progress bar container */}
                    <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-white/5">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${
                          isOver ? 'bg-gradient-to-r from-rose-500 to-red-600' :
                          pct > 80 ? 'bg-gradient-to-r from-amber-500 to-amber-600' : 
                          'bg-gradient-to-r from-indigo-500 to-purple-600'
                        }`}
                        style={{ width: `${pct}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RECHARTS VISUALIZATION */}
        <div className="glass-card p-6 flex flex-col gap-4 lg:col-span-2">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Activity className="text-purple-400" size={20} />
              Spend Allocation
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Comparative chart of monthly expenditures by category</p>
          </div>

          <div className="w-full h-[220px]">
            {budgets.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">
                No visualization data. Seed the database to view.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={budgets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="category" stroke="#8c9ba5" fontSize={11} tickLine={false} />
                  <YAxis stroke="#8c9ba5" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#121826', borderColor: 'rgba(255,255,255,0.08)', borderRadius: '8px' }}
                    labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                    itemStyle={{ color: '#6366f1' }}
                  />
                  <Bar dataKey="spent" radius={[4, 4, 0, 0]}>
                    {budgets.map((entry, index) => {
                      const isOver = entry.spent > entry.limit;
                      return (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={isOver ? 'url(#roseGradient)' : 'url(#indigoGradient)'} 
                        />
                      );
                    })}
                  </Bar>
                  {/* Gradients definitions */}
                  <defs>
                    <linearGradient id="indigoGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0.2}/>
                    </linearGradient>
                    <linearGradient id="roseGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#b91c1c" stopOpacity={0.2}/>
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

      </div>

      {/* BOTTOM SECTION: RECENT TRANSACTIONS */}
      <section className="glass-card p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <DollarSign className="text-emerald-400" size={20} />
            Recent Live Ledger
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Live-updating transaction stream directly synced from MongoDB collection</p>
        </div>

        <div className="overflow-x-auto w-full border border-white/5 rounded-xl bg-slate-900/20">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900/80 border-b border-white/10 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="p-4">Timestamp</th>
                <th className="p-4">Raw Merchant</th>
                <th className="p-4">Mapped Merchant / Category</th>
                <th className="p-4">Location</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4">Penny's Contextual Advice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    No transactions found. Simulate a purchase or reset demo data to start.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t._id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 text-slate-400">{new Date(t.timestamp).toLocaleString()}</td>
                    <td className="p-4 font-semibold text-white">{t.merchantRaw}</td>
                    <td className="p-4">
                      {t.vectorMatchedMerchant ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-indigo-400">🎯 {t.vectorMatchedMerchant}</span>
                          <span className="text-[10px] text-slate-500">Category: {t.category}</span>
                        </div>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold text-[10px]">
                          {t.category}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-slate-400">{t.location}</td>
                    <td className="p-4 font-bold text-white">${t.amount.toFixed(2)}</td>
                    <td className="p-4">{getStatusBadge(t.status)}</td>
                    <td className="p-4 max-w-xs truncate text-slate-300 italic" title={t.notes || t.anomalyReason || ''}>
                      {t.status === 'PENDING_REVIEW' ? (
                        <span className="text-amber-400 font-semibold flex items-center gap-1">
                          <AlertCircle size={12} /> {t.anomalyReason}
                        </span>
                      ) : (
                        t.notes || 'Processing...'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* HUMAN IN THE LOOP (ANOMALY VERIFICATION MODAL) */}
      {pendingAnomaly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="glass-card max-w-md w-full p-6 glow-rose border-rose-500/30 bg-slate-900 flex flex-col gap-5 animate-slide-in">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20 text-rose-400">
                <AlertTriangle size={28} className="animate-bounce" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Anomalous Activity Alert</h3>
                <p className="text-xs text-rose-400 font-semibold mt-1">Penny requires user approval to proceed.</p>
              </div>
            </div>

            <div className="bg-slate-950/60 border border-white/5 rounded-xl p-4 flex flex-col gap-2.5 text-xs text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">Merchant (Raw):</span>
                <span className="font-semibold text-white">{pendingAnomaly.merchant}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount:</span>
                <span className="font-bold text-white text-sm text-rose-400">${pendingAnomaly.amount.toFixed(2)}</span>
              </div>
              <div className="flex flex-col gap-1 border-t border-white/5 pt-2.5 mt-1">
                <span className="text-slate-500 font-semibold">Flag Reason:</span>
                <span className="text-slate-300 leading-relaxed font-mono bg-rose-950/30 p-2 rounded border border-rose-950/50">
                  {pendingAnomaly.reason}
                </span>
              </div>
            </div>

            <div className="flex gap-4 mt-2">
              <button 
                onClick={() => handleAnomalyResponse(false)}
                className="flex-1 py-2.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 font-semibold text-sm transition-all cursor-pointer text-center"
              >
                No, Block Transaction
              </button>
              <button 
                onClick={() => handleAnomalyResponse(true)}
                className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all border border-emerald-400/20 cursor-pointer text-center"
              >
                Yes, Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
