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
  AlertCircle,
  ArrowRight,
  Search,
  Filter,
  Database,
  Cpu,
  Layers,
  Play,
  Check,
  Edit2,
  MessageSquare
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

interface Subscription {
  _id: string;
  name: string;
  cost: number;
  frequency: string;
  usage: 'None' | 'Low' | 'Medium' | 'High';
  status: 'Active' | 'Cancelled' | 'Negotiating';
}

interface FinancialGoal {
  _id: string;
  title: string;
  target: number;
  current: number;
}

interface SavingsBucket {
  _id: string;
  name: string;
  balance: number;
}

interface PlanStep {
  type: 'cancel' | 'negotiate' | 'transfer';
  target: string;
  cost?: number;
  amount?: number;
  description: string;
  status: 'pending' | 'executed';
}

interface ActionPlan {
  _id: string;
  transactionId: string;
  timestamp: string;
  steps: PlanStep[];
  status: 'PENDING_EXECUTION' | 'EXECUTED';
}

interface ExecutedAction {
  _id: string;
  actionType: 'CANCEL' | 'NEGOTIATE' | 'TRANSFER';
  target: string;
  details: string;
  timestamp: string;
}

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'overview' | 'workspace' | 'architecture' | 'mongodb' | 'agent' | 'demo'>('overview');

  // Core Data State
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [overallLimit, setOverallLimit] = useState(0);
  const [overallSpent, setOverallSpent] = useState(0);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  // Perceive-Reason-Plan-Act Extra States
  const [checkingBalance, setCheckingBalance] = useState<number>(2450.00);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [savings, setSavings] = useState<SavingsBucket[]>([]);
  const [plans, setPlans] = useState<ActionPlan[]>([]);
  const [actions, setActions] = useState<ExecutedAction[]>([]);

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

  // Search & Filter state for ledger
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  // Budget Editing state
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editLimitValue, setEditLimitValue] = useState('');

  // Selected transaction details modal/panel
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('');

  // Interactive Architecture details
  const [selectedArchStep, setSelectedArchStep] = useState<string | null>('changestream');

  // AI Chat Advisor State
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{ sender: 'user' | 'penny'; text: string; timestamp: string }[]>([
    { sender: 'penny', text: "Hi! I'm Penny, your AI financial guardian. Ask me anything about your budgets, subscriptions, or goals!", timestamp: new Date().toISOString() }
  ]);
  const [isChatSending, setIsChatSending] = useState(false);

  // Form toggle and inputs for budgets
  const [showAddBudget, setShowAddBudget] = useState(false);
  const [newBudgetCategory, setNewBudgetCategory] = useState('');
  const [newBudgetLimit, setNewBudgetLimit] = useState('');

  // Form toggle and inputs for goals
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [newGoalCurrent, setNewGoalCurrent] = useState('');

  // Form toggle and inputs for subscriptions
  const [showAddSub, setShowAddSub] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubCost, setNewSubCost] = useState('');
  const [newSubFrequency, setNewSubFrequency] = useState('monthly');
  const [newSubUsage, setNewSubUsage] = useState('Medium');

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
        setCheckingBalance(data.checkingBalance ?? 2450.00);
        setSubscriptions(data.subscriptions || []);
        setGoals(data.goals || []);
        setSavings(data.savings || []);
        setPlans(data.plans || []);
        setActions(data.actions || []);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  const handleExecutePlanStep = async (planId: string, stepIndex: number) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/action-plans/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, stepIndex })
      });
      if (res.ok) {
        fetchDashboardData();
        setAgentLogs(prev => [...prev, {
          transactionId: 'system',
          message: `⚡ Triggered execution of plan step.`,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error) {
      console.error('Error executing plan step:', error);
    }
  };

  // Seed demo data
  const handleSetupDemo = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/setup-demo`, { method: 'POST' });
      const result = await res.json();
      setAgentLogs(prev => [...prev, {
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

  // Update budget API call
  const handleUpdateBudget = async (category: string) => {
    if (!editLimitValue || isNaN(parseFloat(editLimitValue))) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, limit: parseFloat(editLimitValue) })
      });
      if (res.ok) {
        setEditingCategory(null);
        setEditLimitValue('');
        fetchDashboardData();
        setAgentLogs(prev => [...prev, {
          transactionId: 'system',
          message: `⚙️ Updated budget limit for "${category}" to $${parseFloat(editLimitValue).toFixed(2)}.`,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Simulate transaction trigger
  const handleSimulate = async (merchantRaw: string, amount: string, location: string) => {
    setIsSimulating(true);
    try {
      // Transition agent state visualizer
      setAgentLogs(prev => [...prev, {
        transactionId: 'local-init',
        message: `⚡ Initiating simulator: Sending "${merchantRaw}" ($${amount}) location "${location}"...`,
        timestamp: new Date().toISOString()
      }]);

      await fetch(`${BACKEND_URL}/api/simulate-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantRaw,
          amount,
          location
        })
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsSimulating(false);
    }
  };

  // Manual form submission wrapper
  const handleFormSimulate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simMerchant || !simAmount) return;
    handleSimulate(simMerchant, simAmount, simLocation);
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

  // AI Chat Advisor send message handler
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    const userMsg = chatMessage;
    setChatMessage('');
    setChatHistory(prev => [...prev, { sender: 'user', text: userMsg, timestamp: new Date().toISOString() }]);
    setIsChatSending(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();
      if (data && data.reply) {
        setChatHistory(prev => [...prev, { sender: 'penny', text: data.reply, timestamp: new Date().toISOString() }]);
      } else {
        setChatHistory(prev => [...prev, { sender: 'penny', text: "Sorry, I couldn't process that request right now.", timestamp: new Date().toISOString() }]);
      }
    } catch (error) {
      console.error("Chat error:", error);
      setChatHistory(prev => [...prev, { sender: 'penny', text: "Connection error. Make sure the backend server is running.", timestamp: new Date().toISOString() }]);
    } finally {
      setIsChatSending(false);
    }
  };

  // Budget manual submission
  const handleAddBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBudgetCategory || !newBudgetLimit) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newBudgetCategory, limit: parseFloat(newBudgetLimit) })
      });
      if (res.ok) {
        setNewBudgetCategory('');
        setNewBudgetLimit('');
        setShowAddBudget(false);
        fetchDashboardData();
        setAgentLogs(prev => [...prev, {
          transactionId: 'system',
          message: `⚙️ Manually added budget category "${newBudgetCategory}" with limit $${parseFloat(newBudgetLimit).toFixed(2)}.`,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Goal manual submission
  const handleAddGoalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalTitle || !newGoalTarget) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newGoalTitle,
          target: parseFloat(newGoalTarget),
          current: parseFloat(newGoalCurrent || '0')
        })
      });
      if (res.ok) {
        setNewGoalTitle('');
        setNewGoalTarget('');
        setNewGoalCurrent('');
        setShowAddGoal(false);
        fetchDashboardData();
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Subscription manual submission
  const handleAddSubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName || !newSubCost) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSubName,
          cost: parseFloat(newSubCost),
          frequency: newSubFrequency,
          usage: newSubUsage
        })
      });
      if (res.ok) {
        setNewSubName('');
        setNewSubCost('');
        setShowAddSub(false);
        fetchDashboardData();
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Action plan batch execution
  const handleExecuteAllPlanSteps = async (planId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/action-plans/execute-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId })
      });
      if (res.ok) {
        fetchDashboardData();
        setAgentLogs(prev => [...prev, {
          transactionId: 'system',
          message: `⚡ Triggered batch execution of all pending plan steps.`,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error) {
      console.error('Error executing all steps:', error);
    }
  };

  // Subscription manual cancel
  const handleCancelSubscription = async (subId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/subscriptions/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subId })
      });
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (error) {
      console.error("Error cancelling subscription:", error);
    }
  };

  // Subscription manual negotiate
  const handleNegotiateSubscription = async (subId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/subscriptions/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subId })
      });
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (error) {
      console.error("Error negotiating subscription:", error);
    }
  };

  // Ledger recategorize and delete transaction adjustments
  const handleRecategorizeTransaction = async (txId: string, newCategory: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/transactions/recategorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId, category: newCategory })
      });
      if (res.ok) {
        fetchDashboardData();
        setSelectedTx(prev => prev ? { ...prev, category: newCategory } : null);
      }
    } catch (error) {
      console.error("Error recategorizing transaction:", error);
    }
  };

  const handleDeleteTransaction = async (txId: string) => {
    if (!window.confirm("Are you sure you want to delete this transaction?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/transactions/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId })
      });
      if (res.ok) {
        setSelectedTx(null);
        fetchDashboardData();
      }
    } catch (error) {
      console.error("Error deleting transaction:", error);
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

  // Calculate current cognitive state based on logs
  const getAgentStatus = () => {
    if (pendingAnomaly) return { status: 'Awaiting HITL Review', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30 animate-pulse' };
    if (isSimulating) return { status: 'Triggering Event Stream', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30 animate-pulse' };
    if (agentLogs.length === 0) return { status: 'Idle', color: 'text-slate-400 bg-slate-900 border-white/5' };
    
    const lastLog = agentLogs[agentLogs.length - 1].message;
    if (lastLog.includes('Change Stream')) return { status: 'Analyzing Change Stream', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30 animate-pulse' };
    if (lastLog.includes('reasoning loop') || lastLog.includes('🧠')) return { status: 'Prompting Gemini LLM', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30 animate-pulse' };
    if (lastLog.includes('execute tool') || lastLog.includes('🛠️')) return { status: 'Executing Tool Call', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30 animate-pulse' };
    if (lastLog.includes('budget') || lastLog.includes('📊')) return { status: 'Auditing Aggregations', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 animate-pulse' };
    if (lastLog.includes('approved') || lastLog.includes('Completed')) return { status: 'Idle', color: 'text-slate-400 bg-slate-900 border-white/5' };
    
    return { status: 'Active (Thinking)', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30 animate-pulse' };
  };

  // Filter Ledger Data
  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.merchantRaw.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (t.vectorMatchedMerchant && t.vectorMatchedMerchant.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesCategory = categoryFilter === 'All' || t.category === categoryFilter;
    const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
    
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const categoriesList = ['All', ...new Set(budgets.map(b => b.category))];
  const currentAgentState = getAgentStatus();
  <style>{`
      button {
        background-color: #1e1e2f !important;
        color: #ffffff !important;
        border: 1px solid #3b3b4f !important;
        padding: 6px 12px !important;
        border-radius: 6px !important;
        cursor: pointer !important;
      }
      button:hover {
        background-color: #2b2b3f !important;
      }
      .sidebar-item, .nav-tabs {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
      }
    `}</style>
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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent">Penny</h1>
              <span className="px-2 py-0.5 text-[10px] font-bold tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded uppercase">Guardian V1.0</span>
            </div>
            <p className="text-xs text-slate-400">MongoDB-Driven Live Agentic Personal Finance Broker</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
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

      {/* DYNAMIC NAVIGATION TABS - Recreating User Mockup Layout */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-white/5">
        <button 
          onClick={() => setActiveTab('overview')}
          className={`tab-btn ${activeTab === 'overview' ? 'tab-btn-active' : ''}`}
        >
          Overview
        </button>
        <button 
          onClick={() => setActiveTab('workspace')}
          className={`tab-btn ${activeTab === 'workspace' ? 'tab-btn-active' : ''}`}
        >
          Live Workspace
        </button>
        <button 
          onClick={() => setActiveTab('architecture')}
          className={`tab-btn ${activeTab === 'architecture' ? 'tab-btn-active' : ''}`}
        >
          Architecture
        </button>
        <button 
          onClick={() => setActiveTab('mongodb')}
          className={`tab-btn ${activeTab === 'mongodb' ? 'tab-btn-active' : ''}`}
        >
          MongoDB Design
        </button>
        <button 
          onClick={() => setActiveTab('agent')}
          className={`tab-btn ${activeTab === 'agent' ? 'tab-btn-active' : ''}`}
        >
          Agent Loop
        </button>
        <button 
          onClick={() => setActiveTab('demo')}
          className={`tab-btn ${activeTab === 'demo' ? 'tab-btn-active' : ''}`}
        >
          Demo Story
        </button>
      </div>

      {/* ======================================================== */}
      {/* 1. OVERVIEW TAB - Recreating the User mockup details */}
      {/* ======================================================== */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-6 animate-fade-in">
          {/* Problem Statement Card */}
          <div className="glass-card p-6 border-l-4 border-l-emerald-500 bg-slate-900/30">
            <span className="pill-emerald mb-3">Problem statement</span>
            <h2 className="text-xl font-bold text-white tracking-tight mt-1 mb-2">"Where did my money go?"</h2>
            <p className="text-sm text-slate-300 leading-relaxed max-w-4xl">
              People check their bank balance, find it lower than expected, and have no idea why. Existing apps show spending categories — but they never <em className="text-indigo-400 font-semibold">act</em>. This agent monitors your transactions in real time, reasons about patterns, detects silent money drains, and takes autonomous corrective action.
            </p>
          </div>

          {/* Core Agentic Section */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">What makes this genuinely agentic</p>
            
            <div className="grid grid-cols-1 grid-cols-4 gap-6">
              
              <div className="glass-card p-6 flex flex-col gap-3 bg-zinc-900/40 border border-white/5 hover:border-indigo-500/20">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">👁️</span>
                  <h3 className="text-base font-semibold text-white">Perceive</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Ingests live bank transactions, merchant metadata, subscription signals, and user-stated financial goals from MongoDB.
                </p>
              </div>

              <div className="glass-card p-6 flex flex-col gap-3 bg-zinc-900/40 border border-white/5 hover:border-purple-500/20">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🧠</span>
                  <h3 className="text-base font-semibold text-white">Reason</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Uses Gemini to interpret spending patterns, classify anomalies, and identify the "why" behind balance drops.
                </p>
              </div>

              <div className="glass-card p-6 flex flex-col gap-3 bg-zinc-900/40 border border-white/5 hover:border-amber-500/20">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">📋</span>
                  <h3 className="text-base font-semibold text-white">Plan</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Generates a multi-step action plan: what to cancel, what to renegotiate, what to shift to savings.
                </p>
              </div>

              <div className="glass-card p-6 flex flex-col gap-3 bg-zinc-900/40 border border-white/5 hover:border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">⚡</span>
                  <h3 className="text-base font-semibold text-white">Act</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Executes cancellations, sends alerts, moves money to savings buckets, and logs everything back to MongoDB.
                </p>
              </div>

            </div>
          </div>

          {/* Name Idea Card */}
          <div className="glass-card p-6 bg-zinc-900/20 border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span className="text-yellow-400">💡</span> "Penny" — Your Autonomous Financial Guardian
              </h3>
              <p className="text-xs text-slate-400 mt-1">Tagline: <span className="italic text-indigo-300">You earn it. Penny protects it.</span></p>
            </div>
            
            <button 
              onClick={() => setActiveTab('workspace')}
              className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer w-full sm:w-auto"
            >
              Launch Live Workspace <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. LIVE WORKSPACE TAB - Interactive Dashboard & Operations */}
      {/* ======================================================== */}
      {activeTab === 'workspace' && (
        <div className="flex flex-col gap-6 animate-fade-in">
          
          {/* OVERVIEW STATS CARDS */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {/* Card 1: Checking Balance */}
            <div className="glass-card glow-emerald p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Checking Balance</p>
                <h3 className="text-2xl font-bold mt-1 text-white">${checkingBalance.toFixed(2)}</h3>
                <p className="text-[10px] text-slate-500 mt-1">Available Funds</p>
              </div>
              <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
                <DollarSign size={20} />
              </div>
            </div>

            {/* Card 2: Overall Budget Limit */}
            <div className="glass-card glow-indigo p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Overall Budget Limit</p>
                <h3 className="text-2xl font-bold mt-1 text-white">${overallLimit.toFixed(2)}</h3>
                <p className="text-[10px] text-slate-500 mt-1">Stated Monthly Limit</p>
              </div>
              <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
                <Layers size={20} />
              </div>
            </div>

            {/* Card 3: Total Monthly Spent */}
            <div className="glass-card glow-purple p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Monthly Spent</p>
                <h3 className="text-2xl font-bold mt-1 text-white">${overallSpent.toFixed(2)}</h3>
                <p className="text-[10px] mt-1 text-slate-400">
                  {overallLimit > 0 ? `${((overallSpent / overallLimit) * 100).toFixed(1)}% limit utilized` : 'No limits'}
                </p>
              </div>
              <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
                <Activity size={20} />
              </div>
            </div>

            {/* Card 4: Subscription Drain */}
            <div className="glass-card glow-rose p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Subscription Drain</p>
                <h3 className="text-2xl font-bold mt-1 text-rose-400">
                  ${subscriptions.filter(s => s.status !== 'Cancelled').reduce((sum, s) => sum + s.cost, 0).toFixed(2)}/mo
                </h3>
                <p className="text-[10px] text-slate-500 mt-1">
                  {subscriptions.filter(s => s.status !== 'Cancelled').length} active subscriptions
                </p>
              </div>
              <div className="p-2.5 bg-rose-500/10 rounded-xl border border-rose-500/20 text-rose-400">
                <AlertCircle size={20} />
              </div>
            </div>

            {/* Card 5: Cognitive Agent State Indicator */}
            <div className="glass-card glow-indigo p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Penny Cognitive State</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border flex items-center gap-1.5 ${currentAgentState.color}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping"></span>
                    {currentAgentState.status}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Synced with Atlas streams</p>
              </div>
              <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
                <Cpu size={20} />
              </div>
            </div>
          </section>

          {/* MAIN THREE-COLUMN WORKSPACE */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* COLUMN 1: SIMULATOR & BUDGETS & GOALS */}
            <div className="flex flex-col gap-6 lg:col-span-1">
              
              {/* Simulator Card */}
              <div className="glass-card p-6 flex flex-col gap-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <PlusCircle className="text-indigo-400" size={18} />
                    Simulator
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Simulate purchase to fire Atlas change stream listener</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sim Preset Shortcuts</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => { setSimMerchant('Starbucks Coffee'); setSimAmount('6.80'); setSimLocation('New York, USA'); }}
                      className="p-2.5 text-left text-xs bg-slate-950/40 hover:bg-emerald-500/5 border border-white/5 hover:border-emerald-500/20 rounded-xl transition-all hover:scale-[1.02] cursor-pointer"
                    >
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">☕ Starbucks ($6.80)</span>
                      <span className="block text-[9px] text-slate-500 mt-0.5">Normal Food & Dining</span>
                    </button>
                    <button 
                      onClick={() => { setSimMerchant('Uber Ride London'); setSimAmount('24.50'); setSimLocation('London, UK'); }}
                      className="p-2.5 text-left text-xs bg-slate-950/40 hover:bg-indigo-500/5 border border-white/5 hover:border-indigo-500/20 rounded-xl transition-all hover:scale-[1.02] cursor-pointer"
                    >
                      <span className="text-indigo-400 font-semibold flex items-center gap-1">🚕 Uber Ride ($24.50)</span>
                      <span className="block text-[9px] text-slate-500 mt-0.5">Normal Travel</span>
                    </button>
                    <button 
                      onClick={() => { setSimMerchant('Emirates Airlines'); setSimAmount('350.00'); setSimLocation('London, UK'); }}
                      className="p-2.5 text-left text-xs bg-slate-950/40 hover:bg-amber-500/5 border border-white/5 hover:border-amber-500/20 rounded-xl transition-all hover:scale-[1.02] cursor-pointer"
                    >
                      <span className="text-amber-400 font-semibold flex items-center gap-1">✈️ Emirates ($350)</span>
                      <span className="block text-[9px] text-amber-500/80 mt-0.5 font-medium">⚠️ Over-Budget Trigger</span>
                    </button>
                    <button 
                      onClick={() => { setSimMerchant('Apple Store Regent St'); setSimAmount('850.00'); setSimLocation('London, UK'); }}
                      className="p-2.5 text-left text-xs bg-slate-950/40 hover:bg-rose-500/5 border border-white/5 hover:border-rose-500/20 rounded-xl transition-all hover:scale-[1.02] cursor-pointer"
                    >
                      <span className="text-rose-400 font-semibold flex items-center gap-1">💻 Apple Store ($850)</span>
                      <span className="block text-[9px] text-rose-500/80 mt-0.5 font-medium">🚨 High-Risk Anomaly</span>
                    </button>
                  </div>
                </div>

                <form onSubmit={handleFormSimulate} className="flex flex-col gap-3 mt-1">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-400">Raw Merchant Text</label>
                    <input 
                      type="text" 
                      value={simMerchant} 
                      onChange={(e) => setSimMerchant(e.target.value)}
                      placeholder="e.g. Starbucks Cafe London"
                      className="w-full bg-slate-950/60 border border-white/15 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs focus:outline-none transition-all"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400">Amount ($)</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={simAmount} 
                        onChange={(e) => setSimAmount(e.target.value)}
                        className="w-full bg-slate-950/60 border border-white/15 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs focus:outline-none transition-all"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400">Location</label>
                      <input 
                        type="text" 
                        value={simLocation} 
                        onChange={(e) => setSimLocation(e.target.value)}
                        className="w-full bg-slate-950/60 border border-white/15 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs focus:outline-none transition-all"
                        required
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isSimulating}
                    className="w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-semibold text-xs border border-indigo-400/20 transition-all flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Send size={12} />
                    {isSimulating ? 'Simulating...' : 'Simulate Purchase'}
                  </button>
                </form>
              </div>

              {/* Category Budgets */}
              <div className="glass-card p-6 flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <Settings className="text-indigo-400" size={18} />
                      Category Budgets
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">Click edit icon to adjust MongoDB budgets</p>
                  </div>
                  <button 
                    onClick={() => setShowAddBudget(!showAddBudget)}
                    className="p-1 rounded bg-slate-900 border border-white/5 hover:border-white/10 text-slate-400 hover:text-white"
                    title="Add new category budget"
                  >
                    <PlusCircle size={15} />
                  </button>
                </div>

                {showAddBudget && (
                  <form onSubmit={handleAddBudgetSubmit} className="p-3 rounded-lg bg-slate-950/60 border border-white/5 flex flex-col gap-2 animate-slide-in">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">New Budget</div>
                    <div className="flex flex-col gap-1.5">
                      <input 
                        type="text" 
                        placeholder="Category Name (e.g. Shopping)"
                        value={newBudgetCategory}
                        onChange={(e) => setNewBudgetCategory(e.target.value)}
                        className="bg-slate-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 w-full"
                        required
                      />
                      <input 
                        type="number" 
                        placeholder="Limit Amount ($)"
                        value={newBudgetLimit}
                        onChange={(e) => setNewBudgetLimit(e.target.value)}
                        className="bg-slate-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 w-full"
                        required
                      />
                    </div>
                    <div className="flex gap-2 justify-end mt-1">
                      <button 
                        type="button" 
                        onClick={() => setShowAddBudget(false)}
                        className="px-2 py-1 text-[10px] font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 rounded border border-white/5"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="px-2.5 py-1 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded border border-indigo-400/20"
                      >
                        Add Budget
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex flex-col gap-3.5">
                  {budgets.map((b, idx) => {
                    const pct = Math.min((b.spent / b.limit) * 100, 100);
                    const isOver = b.spent > b.limit;
                    
                    return (
                      <div key={idx} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-300 font-medium">{b.category}</span>
                          
                          {editingCategory === b.category ? (
                            <div className="flex items-center gap-1">
                              <span className="text-slate-500">$</span>
                              <input 
                                type="number" 
                                value={editLimitValue}
                                onChange={(e) => setEditLimitValue(e.target.value)}
                                className="w-16 bg-slate-950/80 border border-indigo-500/50 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                                placeholder={b.limit.toString()}
                                autoFocus
                              />
                              <button 
                                onClick={() => handleUpdateBudget(b.category)}
                                className="p-0.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                              >
                                <Check size={12} />
                              </button>
                              <button 
                                onClick={() => setEditingCategory(null)}
                                className="p-0.5 rounded bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                              >
                                <XCircle size={12} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group">
                              <span className={isOver ? 'text-rose-400 font-semibold' : 'text-slate-400'}>
                                ${b.spent.toFixed(2)} / ${b.limit}
                              </span>
                              <button 
                                onClick={() => { setEditingCategory(b.category); setEditLimitValue(b.limit.toString()); }}
                                className="text-slate-500 hover:text-white transition-colors cursor-pointer"
                              >
                                <Edit2 size={11} />
                              </button>
                            </div>
                          )}
                        </div>
                        {/* Progress Bar */}
                        <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-white/5">
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
                  })}
                </div>
              </div>

              {/* Financial Goals */}
              <div className="glass-card p-6 flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <span className="text-emerald-400">🎯</span>
                      Financial Goals
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">Track your savings targets boosted by Penny's automated transfers</p>
                  </div>
                  <button 
                    onClick={() => setShowAddGoal(!showAddGoal)}
                    className="p-1 rounded bg-slate-900 border border-white/5 hover:border-white/10 text-slate-400 hover:text-white"
                    title="Add new financial goal"
                  >
                    <PlusCircle size={15} />
                  </button>
                </div>

                {showAddGoal && (
                  <form onSubmit={handleAddGoalSubmit} className="p-3 rounded-lg bg-slate-950/60 border border-white/5 flex flex-col gap-2 animate-slide-in">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">New Saving Goal</div>
                    <div className="flex flex-col gap-1.5">
                      <input 
                        type="text" 
                        placeholder="Goal Title (e.g. Hawaii Trip)"
                        value={newGoalTitle}
                        onChange={(e) => setNewGoalTitle(e.target.value)}
                        className="bg-slate-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 w-full"
                        required
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input 
                          type="number" 
                          placeholder="Target ($)"
                          value={newGoalTarget}
                          onChange={(e) => setNewGoalTarget(e.target.value)}
                          className="bg-slate-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 w-full"
                          required
                        />
                        <input 
                          type="number" 
                          placeholder="Current ($)"
                          value={newGoalCurrent}
                          onChange={(e) => setNewGoalCurrent(e.target.value)}
                          className="bg-slate-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 w-full"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end mt-1">
                      <button 
                        type="button" 
                        onClick={() => setShowAddGoal(false)}
                        className="px-2 py-1 text-[10px] font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 rounded border border-white/5"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="px-2.5 py-1 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded border border-indigo-400/20"
                      >
                        Add Goal
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex flex-col gap-4">
                  {goals.length === 0 ? (
                    <div className="text-slate-500 text-center py-4 text-xs">No active goals found. Reset demo data.</div>
                  ) : (
                    goals.map((g, idx) => {
                      const pct = Math.min((g.current / g.target) * 100, 100);
                      return (
                        <div key={idx} className="flex flex-col gap-1.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-200 font-semibold">{g.title}</span>
                            <span className="text-slate-400 font-medium">${g.current} / ${g.target}</span>
                          </div>
                          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-white/5">
                            <div 
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            ></div>
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-slate-500">
                            <span>Progress</span>
                            <span>{pct.toFixed(0)}%</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
            
            {/* COLUMN 2: REASONING STREAM & ACTIVE PLANS & EXECUTED ACTIONS LOG */}
            <div className="flex flex-col gap-6 lg:col-span-1">
              
              {/* Live Terminal */}
              <div className="terminal-frame flex flex-col h-[400px]">
                <div className="terminal-header">
                  <div className="terminal-dots">
                    <span className="terminal-dot terminal-dot-red"></span>
                    <span className="terminal-dot terminal-dot-yellow"></span>
                    <span className="terminal-dot terminal-dot-green"></span>
                  </div>
                  <div className="terminal-title">Penny Log Shell</div>
                  <button 
                    onClick={() => setAgentLogs([])}
                    className="px-2.5 py-1 text-[9px] font-bold bg-white/5 border border-white/5 hover:border-white/10 text-slate-400 hover:text-white rounded-md transition-all cursor-pointer"
                  >
                    Clear Log
                  </button>
                </div>

                <div className="flex-1 bg-[#020306] p-4 overflow-y-auto flex flex-col gap-2 font-mono scrollbar-thin">
                  {agentLogs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center gap-2 py-10">
                      <Terminal size={24} className="animate-pulse text-slate-700" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Awaiting Live Events</p>
                      <p className="text-[9px] text-slate-600 max-w-xs">Simulate a transaction or trigger a preset above to stream Penny's active cognitive steps.</p>
                    </div>
                  ) : (
                    agentLogs.map((log, index) => {
                      let textClass = 'text-slate-300';
                      let prefix = null;
                      let msg = log.message;

                      if (msg.startsWith('[Agent Penny]:')) {
                        textClass = 'text-purple-300/90';
                        prefix = <span className="term-prefix-agent">🧠 [Advisor]</span>;
                        msg = msg.replace('[Agent Penny]:', '').trim();
                      } else if (msg.includes('⚡ Acted:')) {
                        textClass = 'text-emerald-400/90';
                        prefix = <span className="term-prefix-acted">⚡ [Acted]</span>;
                        msg = msg.replace('⚡ Acted:', '').trim();
                      } else if (msg.includes('📋 Generated Plan:') || msg.includes('Plan:')) {
                        textClass = 'text-amber-400/90';
                        prefix = <span className="term-prefix-plan">📋 [Plan]</span>;
                        msg = msg.replace('📋 Generated Plan:', '').replace('Plan:', '').trim();
                      } else if (msg.includes('Budget breached') || msg.includes('🚨') || msg.includes('Anomaly') || msg.includes('⚠️')) {
                        textClass = 'text-rose-400/90';
                        prefix = <span className="term-prefix-breach">⚠️ [Audit]</span>;
                      } else if (msg.includes('🛠️') || msg.includes('Step') || msg.includes('📊')) {
                        textClass = 'text-cyan-400/90';
                        prefix = <span className="term-prefix-tool">🛠️ [Reason]</span>;
                      } else if (msg.includes('Triggered batch execution') || msg.includes('⚡')) {
                        textClass = 'text-indigo-400/90';
                        prefix = <span className="term-prefix-system">⚡ [System]</span>;
                      }

                      return (
                        <div key={index} className={`terminal-line ${textClass} border-l border-white/5 bg-white/[0.01] py-1 px-2.5 rounded hover:bg-white/[0.03] transition-all animate-slide-in text-[10px] flex items-start gap-2 font-mono leading-relaxed`}>
                          <span className="text-[9px] text-slate-600 shrink-0 select-none">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                          <div className="flex-1">
                            {prefix} {msg}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {/* Active Action Plans */}
              <div className="glass-card p-6 flex flex-col gap-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="text-purple-400">📋</span>
                    Active Action Plans
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Review and execute Penny's proposed financial recovery plans</p>
                </div>
                <div className="flex flex-col gap-3 overflow-y-auto max-h-[300px]">
                  {plans.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-500 text-center gap-2">
                      <span className="text-xl">📋</span>
                      <p className="text-xs">No active action plans</p>
                      <p className="text-[10px] text-slate-600">Simulate an over-budget transaction to trigger a plan</p>
                    </div>
                  ) : (
                    plans.map((plan) => (
                      <div key={plan._id} className="p-3.5 rounded-xl bg-slate-950/40 border border-white/5 flex flex-col gap-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            Plan: {plan.status}
                          </span>
                          <span className="text-[9px] text-slate-500">{new Date(plan.timestamp).toLocaleTimeString()}</span>
                        </div>
                        
                        <div className="flex flex-col gap-2 mt-1">
                          {plan.steps.map((step, sIdx) => (
                            <div key={sIdx} className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-white/5 text-[11px]">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-semibold text-slate-200">{step.description}</span>
                                <span className="text-[9px] text-slate-500 capitalize">Type: {step.type}</span>
                              </div>
                              {step.status === 'executed' ? (
                                <span className="px-2 py-0.5 text-[9px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center gap-1">
                                  <Check size={10} /> Executed
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleExecutePlanStep(plan._id, sIdx)}
                                  className="px-2.5 py-1 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded border border-indigo-400/20 transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  <Play size={10} /> Execute
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {plan.steps.some((step: any) => step.status !== 'executed') && (
                          <button
                            onClick={() => handleExecuteAllPlanSteps(plan._id)}
                            className="w-full py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-semibold text-xs border border-indigo-400/20 transition-all flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Play size={11} /> Execute All Steps
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Executed Actions Log */}
              <div className="glass-card p-6 flex flex-col gap-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="text-emerald-400">⚡</span>
                    Executed Actions
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Log of autonomous acts and human-triggered adjustments</p>
                </div>
                <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[250px]">
                  {actions.length === 0 ? (
                    <div className="text-slate-500 text-center py-6 text-xs">No executed actions logged yet</div>
                  ) : (
                    actions.map((act) => {
                      let icon = '⚡';
                      let badgeColor = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
                      if (act.actionType === 'CANCEL') {
                        icon = '🚫';
                        badgeColor = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
                      } else if (act.actionType === 'TRANSFER') {
                        icon = '💰';
                        badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                      } else if (act.actionType === 'NEGOTIATE') {
                        icon = '🤝';
                        badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
                      }
                      return (
                        <div key={act._id} className="p-3 rounded-lg bg-slate-950/40 border border-white/5 flex gap-2.5 items-start">
                          <span className="text-base">{icon}</span>
                          <div className="flex-1 flex flex-col gap-0.5 text-xs">
                            <div className="flex justify-between items-center">
                              <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${badgeColor}`}>
                                {act.actionType}
                              </span>
                              <span className="text-[9px] text-slate-500">{new Date(act.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-slate-300 font-medium mt-1 leading-relaxed">{act.details}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

            {/* COLUMN 3: SUBSCRIPTIONS & COMPACT LEDGER */}
            <div className="flex flex-col gap-6 lg:col-span-1">
              
              {/* Silent Money Drains (Subscriptions) */}
              <div className="glass-card p-6 flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <span className="text-rose-400">🕵️‍♂️</span>
                      Silent Money Drains
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">Active subscriptions categorized by usage activity</p>
                  </div>
                  <button 
                    onClick={() => setShowAddSub(!showAddSub)}
                    className="p-1 rounded bg-slate-900 border border-white/5 hover:border-white/10 text-slate-400 hover:text-white cursor-pointer"
                    title="Add new subscription"
                  >
                    <PlusCircle size={15} />
                  </button>
                </div>

                {showAddSub && (
                  <form onSubmit={handleAddSubSubmit} className="p-3 rounded-lg bg-slate-950/60 border border-white/5 flex flex-col gap-2 animate-slide-in text-xs">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">New Subscription</div>
                    <div className="flex flex-col gap-1.5">
                      <input 
                        type="text" 
                        placeholder="Subscription Name (e.g. Netflix)"
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value)}
                        className="bg-slate-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 w-full"
                        required
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input 
                          type="number" 
                          placeholder="Cost ($)"
                          value={newSubCost}
                          onChange={(e) => setNewSubCost(e.target.value)}
                          className="bg-slate-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500 w-full"
                          required
                        />
                        <select
                          value={newSubFrequency}
                          onChange={(e) => setNewSubFrequency(e.target.value)}
                          className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none w-full"
                        >
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                          <option value="weekly">Weekly</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-slate-400">Usage Level</label>
                        <select
                          value={newSubUsage}
                          onChange={(e) => setNewSubUsage(e.target.value)}
                          className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none w-full"
                        >
                          <option value="None">None (Unused)</option>
                          <option value="Low">Low Usage</option>
                          <option value="Medium">Medium Usage</option>
                          <option value="High">High Usage</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end mt-1">
                      <button 
                        type="button" 
                        onClick={() => setShowAddSub(false)}
                        className="px-2 py-1 text-[10px] font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 rounded border border-white/5 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="px-2.5 py-1 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded border border-indigo-400/20 cursor-pointer"
                      >
                        Add Subscription
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex flex-col gap-3">
                  {subscriptions.length === 0 ? (
                    <div className="text-slate-500 text-center py-4 text-xs">No subscriptions details. Reset demo data.</div>
                  ) : (
                    subscriptions.map((sub, idx) => {
                      let usageBadge = '';
                      if (sub.usage === 'None') usageBadge = 'bg-rose-500/15 text-rose-400 border-rose-500/30';
                      else if (sub.usage === 'Low') usageBadge = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
                      else if (sub.usage === 'Medium') usageBadge = 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
                      else usageBadge = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
                      
                      let statusBadge = '';
                      if (sub.status === 'Active') statusBadge = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                      else if (sub.status === 'Cancelled') statusBadge = 'bg-slate-800 text-slate-500 border-slate-700';
                      else statusBadge = 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse';

                      const isCancelled = sub.status === 'Cancelled';

                      return (
                        <div key={idx} className={`p-3.5 rounded-xl border flex flex-col gap-2 transition-all ${isCancelled ? 'bg-slate-950/20 border-white/5 opacity-60' : 'bg-slate-950/40 border-white/5 hover:border-white/10'}`}>
                          <div className="flex justify-between items-center w-full">
                            <div className="flex flex-col gap-1">
                              <span className={`text-xs font-bold ${isCancelled ? 'line-through text-slate-500' : 'text-white'}`}>
                                {sub.name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                ${sub.cost.toFixed(2)} / {sub.frequency}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full border ${usageBadge}`}>
                                {sub.usage}
                              </span>
                              <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full border ${statusBadge}`}>
                                {sub.status}
                              </span>
                            </div>
                          </div>

                          {!isCancelled && (
                            <div className="flex gap-2 justify-end border-t border-white/5 pt-2 mt-1 w-full">
                              {sub.status !== 'Negotiating' && (
                                <button
                                  onClick={() => handleNegotiateSubscription(sub._id)}
                                  className="px-2 py-1 text-[10px] font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded border border-amber-500/20 transition-all cursor-pointer"
                                >
                                  Negotiate
                                </button>
                              )}
                              <button
                                onClick={() => handleCancelSubscription(sub._id)}
                                className="px-2 py-1 text-[10px] font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded border border-rose-500/20 transition-all cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Live Ledger with search and filters */}
              <div className="glass-card p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Database className="text-emerald-400" size={18} />
                    Live Ledger
                  </h2>
                  <p className="text-xs text-slate-400">Real-time synced transaction records from Atlas</p>
                </div>

                {/* SEARCH & FILTERS BAR */}
                <div className="flex flex-col gap-2">
                  <div className="relative w-full">
                    <Search className="absolute left-2.5 top-2 text-slate-500" size={13} />
                    <input 
                      type="text"
                      placeholder="Search merchant..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-indigo-500 w-full"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] text-slate-500 uppercase font-semibold">Category</label>
                      <select 
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none w-full"
                      >
                        {categoriesList.map((cat, i) => (
                          <option key={i} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] text-slate-500 uppercase font-semibold">Status</label>
                      <select 
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none w-full"
                      >
                        <option value="All">All Statuses</option>
                        <option value="APPROVED">Approved</option>
                        <option value="PENDING_REVIEW">Pending Review</option>
                        <option value="BLOCKED">Blocked</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* LEDGER CONTENT LIST */}
                <div className="overflow-y-auto max-h-[350px] flex flex-col gap-2 pr-1">
                  {filteredTransactions.length === 0 ? (
                    <div className="text-slate-500 text-center py-6 text-xs">No transactions match filters</div>
                  ) : (
                    filteredTransactions.map((t) => (
                      <div 
                        key={t._id} 
                        onClick={() => { setSelectedTx(t); setSelectedCategory(t.category); }}
                        className="p-3 rounded-lg bg-slate-950/40 border border-white/5 hover:border-white/10 transition-colors cursor-pointer flex justify-between items-center"
                        title="Click to view Vector Search Inspector"
                      >
                        <div className="flex flex-col gap-1 min-w-0">
                          <span className="text-xs font-bold text-white truncate">{t.merchantRaw}</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-white/5 text-[9px] text-slate-400 font-semibold">
                              {t.category}
                            </span>
                            {t.vectorMatchedMerchant && (
                              <span className="text-[9px] text-indigo-400 font-semibold truncate">
                                🎯 {t.vectorMatchedMerchant}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                          <span className="text-xs font-bold text-white">${t.amount.toFixed(2)}</span>
                          {getStatusBadge(t.status)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

          </div>

        </div>
      )}

      {/* ======================================================== */}
      {/* 3. ARCHITECTURE TAB - Complete Visual System Explanation */}
      {/* ======================================================== */}
      {activeTab === 'architecture' && (
        <div className="flex flex-col gap-6 animate-fade-in">
          
          <div className="glass-card p-6">
            <h2 className="text-lg font-bold text-white">System Architecture & Processing Flow</h2>
            <p className="text-xs text-slate-400 mt-1">Penny couples local Express controllers with Atlas Change Streams and vector triggers.</p>

            {/* Static HTML/CSS diagram */}
            <div className="my-6 grid grid-cols-1 md:grid-cols-6 gap-3 items-center text-center">
              
              <div 
                onClick={() => setSelectedArchStep('simulator')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedArchStep === 'simulator' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-slate-900/40'
                }`}
              >
                <div className="text-xl">💳</div>
                <div className="text-xs font-bold text-white mt-1">1. Simulator</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Inserts transaction doc</div>
              </div>

              <div className="text-slate-500 font-bold text-sm hidden md:block">➔</div>

              <div 
                onClick={() => setSelectedArchStep('changestream')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedArchStep === 'changestream' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-slate-900/40'
                }`}
              >
                <div className="text-xl">🔥</div>
                <div className="text-xs font-bold text-white mt-1">2. Change Stream</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Fires backend listener</div>
              </div>

              <div className="text-slate-500 font-bold text-sm hidden md:block">➔</div>

              <div 
                onClick={() => setSelectedArchStep('vector')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedArchStep === 'vector' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-slate-900/40'
                }`}
              >
                <div className="text-xl">🎯</div>
                <div className="text-xs font-bold text-white mt-1">3. Vector Search</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Matches canon merchant</div>
              </div>

              <div className="text-slate-500 font-bold text-sm hidden md:block">➔</div>

              <div 
                onClick={() => setSelectedArchStep('gemini')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedArchStep === 'gemini' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-slate-900/40'
                }`}
              >
                <div className="text-xl">🧠</div>
                <div className="text-xs font-bold text-white mt-1">4. Gemini Loop</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Resolves and decides</div>
              </div>

              <div className="text-slate-500 font-bold text-sm hidden md:block">➔</div>

              <div 
                onClick={() => setSelectedArchStep('aggregations')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedArchStep === 'aggregations' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-slate-900/40'
                }`}
              >
                <div className="text-xl">📊</div>
                <div className="text-xs font-bold text-white mt-1">5. Aggregations</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Checks budget totals</div>
              </div>

              <div className="text-slate-500 font-bold text-sm hidden md:block">➔</div>

              <div 
                onClick={() => setSelectedArchStep('websockets')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedArchStep === 'websockets' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-slate-900/40'
                }`}
              >
                <div className="text-xl">🔌</div>
                <div className="text-xs font-bold text-white mt-1">6. UI Websockets</div>
                <div className="text-[9px] text-slate-500 mt-0.5">Renders updates live</div>
              </div>

            </div>

            {/* Step Detail Drawer */}
            <div className="bg-slate-950/60 rounded-xl p-4 border border-white/5 text-xs">
              {selectedArchStep === 'simulator' && (
                <div>
                  <h3 className="text-sm font-semibold text-indigo-400 mb-1">Step 1: Event Generation (Simulator)</h3>
                  <p className="text-slate-300 leading-relaxed">
                    When a user makes a purchase, a document is inserted into the `transactions` collection. In our demo, this is triggered via the interactive preset buttons or the manual form in the sidebar. This simulates real-world card swipe notification payloads.
                  </p>
                </div>
              )}
              {selectedArchStep === 'changestream' && (
                <div>
                  <h3 className="text-sm font-semibold text-indigo-400 mb-1">Step 2: Reactive Triggering (MongoDB Change Streams)</h3>
                  <p className="text-slate-300 leading-relaxed">
                    Instead of polling the database, the backend uses `transactionsCol.watch([{"[{ $match: { operationType: 'insert' } }]"}])`. The change stream listener detects new transaction records instantly (under 50ms) and invokes the main processing loop.
                  </p>
                </div>
              )}
              {selectedArchStep === 'vector' && (
                <div>
                  <h3 className="text-sm font-semibold text-indigo-400 mb-1">Step 3: Atlas Vector Search Matching</h3>
                  <p className="text-slate-300 leading-relaxed">
                    Messy transaction strings (e.g. `Uber London Ride *4321`) are turned into semantic vectors using Gemini's `text-embedding-004` embedding model. The backend runs a `$vectorSearch` pipeline on the `merchants` collection to find standard merchant details, resolving category mappings dynamically.
                  </p>
                </div>
              )}
              {selectedArchStep === 'gemini' && (
                <div>
                  <h3 className="text-sm font-semibold text-indigo-400 mb-1">Step 4: Autonomous Gemini 2.5 Flash Reasoning</h3>
                  <p className="text-slate-300 leading-relaxed">
                    The transaction details are passed to the Gemini chat agent configured with a strict system instruction. The agent reasons step-by-step and uses function calling (tool declarations) to execute actions. It calls `checkBudgetProgress` or `flagAnomaly` or `approveAndCategorize` depending on the risk parameters.
                  </p>
                </div>
              )}
              {selectedArchStep === 'aggregations' && (
                <div>
                  <h3 className="text-sm font-semibold text-indigo-400 mb-1">Step 5: MongoDB Aggregation pipeline audits</h3>
                  <p className="text-slate-300 leading-relaxed">
                    When Gemini calls the budget checking tool, the backend triggers an aggregation pipeline (`$match` by user, `$group` by category to `$sum` amount). This returns precise, up-to-date spending stats. Gemini uses this to decide whether to warning-flag the purchase or suggest savings tips.
                  </p>
                </div>
              )}
              {selectedArchStep === 'websockets' && (
                <div>
                  <h3 className="text-sm font-semibold text-indigo-400 mb-1">Step 6: Streaming Updates (Socket.io)</h3>
                  <p className="text-slate-300 leading-relaxed">
                    Throughout the reasoning chain, the backend emits `agent-thought` events containing Penny's inner monologue, matching metadata, and tool actions. These are captured by the React dashboard via Websockets and rendered in the terminal log line-by-line.
                  </p>
                </div>
              )}
            </div>

          </div>

        </div>
      )}

      {/* ======================================================== */}
      {/* 4. MONGODB DESIGN TAB - Vector Index, aggregation pipelines */}
      {/* ======================================================== */}
      {activeTab === 'mongodb' && (
        <div className="flex flex-col gap-6 animate-fade-in text-xs">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Vector Search Configuration */}
            <div className="glass-card p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Database className="text-indigo-400" size={18} />
                <h3 className="text-sm font-bold text-white">Atlas Vector Search Index</h3>
              </div>
              <p className="text-slate-400">
                Created on the `merchants` collection to index the `embedding` field generated via Gemini `text-embedding-004`.
              </p>
              
              <div className="code-container mt-2">
{`{
  "fields": [
    {
      "numDimensions": 768,
      "path": "embedding",
      "similarity": "cosine",
      "type": "vector"
    }
  ]
}`}
              </div>
            </div>

            {/* Aggregations Pipeline */}
            <div className="glass-card p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Layers className="text-indigo-400" size={18} />
                <h3 className="text-sm font-bold text-white">Aggregations Pipeline</h3>
              </div>
              <p className="text-slate-400">
                Aggregates total monthly expenditures grouped by category in real time to prevent delayed auditing.
              </p>

              <div className="code-container mt-2">
{`const pipeline = [
  { $match: { userId: "user_default" } },
  {
    $group: {
      _id: "$category",
      totalSpent: { $sum: "$amount" },
      count: { $sum: 1 }
    }
  },
  {
    $project: {
      category: "$_id",
      totalSpent: 1,
      count: 1,
      _id: 0
    }
  }
];`}
              </div>
            </div>

          </div>

        </div>
      )}

      {/* ======================================================== */}
      {/* 5. AGENT LOOP TAB - Gemini System Instructions & Tools */}
      {/* ======================================================== */}
      {activeTab === 'agent' && (
        <div className="flex flex-col gap-6 animate-fade-in text-xs">
          
          <div className="glass-card p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Cpu className="text-purple-400" size={18} />
              <h3 className="text-sm font-bold text-white">Gemini 2.5 Flash Persona & Instructions</h3>
            </div>
            <p className="text-slate-400">
              Penny is initialized with a system instruction layout defining its persona and cognitive steps.
            </p>
            
            <div className="code-container mt-2 leading-relaxed">
{`You are "Penny", an intelligent, empathetic, and detail-oriented personal finance AI agent.
Your goal is to process incoming financial transactions and make decisions.

For each transaction, you must follow this multi-step reasoning protocol:
1. **Analyze**: Evaluate the merchant, amount, and location.
2. **Merchant Match & Categorization**: Check if the merchant has a resolved category.
3. **Budget Check**: Check how this transaction impacts the monthly budget.
4. **Anomalies / Fraud Check**: Look for suspicious signs.
5. **Decide & Action**: Approve / Warning Limit Alert / Flag Anomaly and halt for human review.`}
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <h4 className="font-semibold text-white text-xs">Declared Tooling Functions:</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-1">
                <div className="bg-slate-950 p-3 rounded-lg border border-white/5">
                  <div className="font-bold text-indigo-400 font-mono">checkBudgetProgress()</div>
                  <div className="text-[11px] text-slate-400 mt-1">Queries Mongo Aggregation pipeline to check category limits.</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-white/5">
                  <div className="font-bold text-rose-400 font-mono">flagAnomaly()</div>
                  <div className="text-[11px] text-slate-400 mt-1">Flags transaction and triggers real-time dashboard modal.</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-white/5">
                  <div className="font-bold text-emerald-400 font-mono">approveAndCategorize()</div>
                  <div className="text-[11px] text-slate-400 mt-1">Logs final approval, mapping, and empathetic advice to document.</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ======================================================== */}
      {/* 6. DEMO STORY TAB - Step-by-Step Presentation Assistant */}
      {/* ======================================================== */}
      {activeTab === 'demo' && (
        <div className="flex flex-col gap-6 animate-fade-in text-xs">
          
          <div className="glass-card p-6">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Play className="text-emerald-400" size={18} />
              Interactive Presentation Assistant
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Use this guided checklist to present Penny seamlessly to the judges.</p>

            <div className="flex flex-col gap-4 mt-6">
              
              {/* Step 1 */}
              <div className="p-4 rounded-xl border border-white/5 bg-slate-900/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="max-w-2xl">
                  <h3 className="font-bold text-white text-xs flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] border border-white/10">1</span>
                    Reset & Seed Database
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Establishes a clean database baseline: seeds limits (Food $300, Travel $200, Groceries $250, Shopping $400), inserts standard embeddings, and clears older transactions.
                  </p>
                </div>
                <button 
                  onClick={handleSetupDemo} 
                  disabled={isSeeding}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold text-xs text-white transition-all flex items-center gap-1 cursor-pointer w-full md:w-auto justify-center"
                >
                  <RefreshCw size={12} className={isSeeding ? 'animate-spin' : ''} />
                  Execute Seed
                </button>
              </div>

              {/* Step 2 */}
              <div className="p-4 rounded-xl border border-white/5 bg-slate-900/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="max-w-2xl">
                  <h3 className="font-bold text-white text-xs flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] border border-white/10">2</span>
                    Standard Transaction Simulation (Starbucks Coffee)
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Inserts `$6.80` transaction. Shows: Atlas Vector Search matching `Starbucks Coffee` to category `Food & Dining` and standard merchant `Starbucks`, auditing budget totals, and final approval with savings tip.
                  </p>
                </div>
                <button 
                  onClick={() => { setActiveTab('workspace'); handleSimulate('Starbucks Coffee', '6.80', 'New York, USA'); }}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white transition-all flex items-center gap-1 cursor-pointer w-full md:w-auto justify-center"
                >
                  Simulate Normal Coffee
                </button>
              </div>

              {/* Step 3 */}
              <div className="p-4 rounded-xl border border-white/5 bg-slate-900/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="max-w-2xl">
                  <h3 className="font-bold text-white text-xs flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] border border-white/10">3</span>
                    Trigger Category Limit Breach (Fly Emirates)
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Inserts `$350.00` flight booking. Shows: Gemini querying budget Aggregations, identifying that the transaction exceeds the `$200` monthly Travel budget, and appending an limit warning alert.
                  </p>
                </div>
                <button 
                  onClick={() => { setActiveTab('workspace'); handleSimulate('Emirates Airlines', '350.00', 'London, UK'); }}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 font-bold text-xs text-white transition-all flex items-center gap-1 cursor-pointer w-full md:w-auto justify-center"
                >
                  Simulate Over-Budget Flight
                </button>
              </div>

              {/* Step 4 */}
              <div className="p-4 rounded-xl border border-white/5 bg-slate-900/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="max-w-2xl">
                  <h3 className="font-bold text-white text-xs flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] border border-white/10">4</span>
                    High-Risk Anomaly & Human-in-the-Loop (Apple Store)
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Inserts `$850.00` transaction. Since amount exceeds the `$500` security threshold, Penny halts approval, flags it as anomalous in the database, and launches the warning-glow review popup on the React client.
                  </p>
                </div>
                <button 
                  onClick={() => { setActiveTab('workspace'); handleSimulate('Apple Store Regent St', '850.00', 'London, UK'); }}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 font-bold text-xs text-white transition-all flex items-center gap-1 cursor-pointer w-full md:w-auto justify-center"
                >
                  Simulate High-Risk Purchase
                </button>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* ======================================================== */}
      {/* VECTOR SEARCH INSPECTOR SIDE-PANEL / MODAL */}
      {/* ======================================================== */}
      {selectedTx && (
        <div className="fixed inset-0 z-40 flex items-center justify-end p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-card max-w-sm w-full p-5 h-full overflow-y-auto flex flex-col gap-4 border-l border-white/10 bg-zinc-950 animate-slide-in">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Database className="text-indigo-400" size={15} />
                Vector Search Inspector
              </h3>
              <button 
                onClick={() => setSelectedTx(null)}
                className="text-slate-500 hover:text-white transition-colors cursor-pointer"
              >
                <XCircle size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs">
              <div className="bg-slate-900 p-3 rounded-lg border border-white/5">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Incoming Raw String</div>
                <div className="text-white font-bold mt-1 text-sm font-mono">"{selectedTx.merchantRaw}"</div>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-white/5 flex flex-col gap-2">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Embeddings Model</div>
                  <div className="text-indigo-400 font-semibold mt-0.5">Google text-embedding-004</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Dimensions / Metric</div>
                  <div className="text-slate-300 mt-0.5">768-dims, Cosine Similarity</div>
                </div>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-white/5">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Resolution Match</div>
                {selectedTx.vectorMatchedMerchant ? (
                  <div className="mt-1.5 flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-emerald-400 font-bold">
                      <CheckCircle size={13} /> Matched Standard Merchant
                    </div>
                    <div className="text-white font-bold text-sm">"{selectedTx.vectorMatchedMerchant}"</div>
                    <div className="text-[10px] text-slate-400">Standardized Category: <span className="font-semibold text-indigo-300">{selectedTx.category}</span></div>
                  </div>
                ) : (
                  <div className="mt-1.5 flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-amber-400 font-bold">
                      <AlertTriangle size={13} /> New Merchant (No match)
                    </div>
                    <p className="text-slate-400 text-[10px] leading-relaxed">
                      Treating as a new brand. Mapped directly to classification: <span className="font-semibold text-white">"{selectedTx.category}"</span>.
                    </p>
                  </div>
                )}
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-white/5">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Penny's Decision Metadata</div>
                <div className="mt-1.5 text-slate-300 leading-relaxed font-sans italic bg-zinc-950 p-2.5 rounded border border-white/5">
                  {selectedTx.notes || selectedTx.anomalyReason || 'Classification logic complete.'}
                </div>
              </div>

              {/* Ledger Adjustments */}
              <div className="bg-slate-900 p-3 rounded-lg border border-white/5 flex flex-col gap-2.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Ledger Adjustments</div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-slate-400">Recategorize</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedCategory || selectedTx.category}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="bg-slate-950/60 border border-white/10 rounded px-2.5 py-1 text-xs text-slate-300 focus:outline-none flex-1"
                    >
                      {budgets.map(b => b.category).map((cat, i) => (
                        <option key={i} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleRecategorizeTransaction(selectedTx._id, selectedCategory || selectedTx.category)}
                      className="px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded border border-indigo-400/20 cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className="border-t border-white/5 pt-2.5 mt-1">
                  <button
                    onClick={() => handleDeleteTransaction(selectedTx._id)}
                    className="w-full py-1.5 bg-rose-600/25 hover:bg-rose-600/35 border border-rose-500/30 text-rose-400 hover:text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Delete Transaction
                  </button>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setSelectedTx(null)}
              className="mt-auto w-full py-2 bg-slate-900 hover:bg-slate-800 border border-white/10 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
            >
              Close Inspector
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* HUMAN IN THE LOOP (ANOMALY VERIFICATION MODAL) */}
      {/* ======================================================== */}
      {pendingAnomaly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fade-in">
          <div className="glass-card max-w-md w-full p-6 glow-rose border-rose-500/30 bg-slate-900 flex flex-col gap-5 animate-slide-in">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20 text-rose-400">
                <AlertTriangle size={24} className="animate-bounce" />
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
                <span className="font-bold text-rose-400 text-sm">${pendingAnomaly.amount.toFixed(2)}</span>
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
                className="flex-1 py-2.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 font-semibold text-xs transition-all cursor-pointer text-center"
              >
                Block Transaction
              </button>
              <button 
                onClick={() => handleAnomalyResponse(true)}
                className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-all border border-emerald-400/20 cursor-pointer text-center"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating AI Advisor Chat Widget */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {chatOpen && (
          <div className="glass-card w-80 sm:w-96 h-[450px] flex flex-col border border-white/10 bg-zinc-950/95 shadow-2xl rounded-2xl overflow-hidden animate-slide-in">
            {/* Chat Header */}
            <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 flex justify-between items-center text-white">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                <div>
                  <h4 className="text-xs font-bold font-sans">Penny AI Advisor</h4>
                  <p className="text-[9px] text-indigo-200">Online & Ready to Assist</p>
                </div>
              </div>
              <button 
                onClick={() => setChatOpen(false)}
                className="text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                <XCircle size={16} />
              </button>
            </div>

            {/* Messages Log */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 scrollbar-thin">
              {chatHistory.map((msg, i) => {
                const isUser = msg.sender === 'user';
                return (
                  <div key={i} className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse self-end' : 'self-start'} max-w-[90%] animate-slide-in`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                      isUser 
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                        : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                    }`}>
                      {isUser ? <User size={11} /> : <Cpu size={11} />}
                    </div>
                    <div className="flex flex-col">
                      <div className={`p-2.5 rounded-2xl text-xs leading-relaxed border ${
                        isUser 
                          ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 border-indigo-500/30 text-white rounded-tr-none shadow-md shadow-indigo-900/10' 
                          : 'bg-slate-900/90 border-white/5 text-slate-200 rounded-tl-none'
                      }`}>
                        {msg.text}
                      </div>
                      <span className={`text-[8px] text-slate-500 mt-1 uppercase tracking-wider px-1 ${isUser ? 'text-right' : 'text-left'}`}>
                        {isUser ? 'You' : 'Penny'} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })}
              {isChatSending && (
                <div className="self-start flex items-start gap-2 max-w-[90%]">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 border bg-purple-500/10 border-purple-500/20 text-purple-400">
                    <Cpu size={11} />
                  </div>
                  <div className="bg-slate-900/90 border border-white/5 text-slate-400 p-2.5 rounded-2xl rounded-tl-none text-xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input Form */}
            <form onSubmit={handleSendChatMessage} className="p-3 border-t border-white/5 bg-slate-950/80 flex gap-2">
              <input 
                type="text" 
                placeholder="Ask Penny about your finances..."
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 placeholder-slate-500"
                disabled={isChatSending}
              />
              <button 
                type="submit" 
                disabled={isChatSending || !chatMessage.trim()}
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 text-white border border-indigo-400/20 transition-all flex items-center justify-center cursor-pointer shrink-0"
              >
                <Send size={14} />
              </button>
            </form>
          </div>
        )}

        {/* Chat Bubble Toggle Button */}
        <button 
          onClick={() => setChatOpen(!chatOpen)}
          className="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 border border-indigo-400/30 text-white hover:scale-105 transition-all cursor-pointer pulse-primary"
        >
          {chatOpen ? (
            <XCircle size={22} />
          ) : (
            <MessageSquare size={22} />
          )}
        </button>
      </div>
    </div>
  );
}
