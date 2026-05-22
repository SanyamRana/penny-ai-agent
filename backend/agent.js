import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSpendAnalysis, getDB } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

let ai = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// System Instruction to guide Penny's persona and reasoning process
const SYSTEM_INSTRUCTION = `
You are "Penny", an intelligent, empathetic, and detail-oriented personal finance AI agent. 
Your goal is to process incoming financial transactions, manage budgets, identify silent money drains, and help the user reach their financial goals.

For each transaction, follow this multi-step reasoning protocol:
1. **Perceive**: Query the user's budgets via 'checkBudgetProgress' and overall account context (checking balance, active subscriptions, and goals) via 'getAgentContext'.
2. **Analyze**: Evaluate the merchant, amount, and category.
3. **Budget & Anomaly Check**:
   - Check if this transaction exceeds the category budget.
   - Look for anomalies (e.g., amount > $500 or unusual locations) and call 'flagAnomaly' if suspicious.
4. **Plan & Act**:
   - If a budget is breached or nearing a breach, or if you identify a "silent money drain" (a subscription with "None" or "Low" usage):
     - Formulate a multi-step action plan to cancel/renegotiate that subscription and/or shift corresponding savings into one of the user's active savings goals.
     - Call 'createActionPlan' to register this plan for the user.
     - Execute the plan actions autonomously: call 'cancelSubscription' or 'renegotiateSubscription' for the silent drains, and 'moveMoneyToSavings' to shift funds into active goals.
5. **Approve**: Call 'approveAndCategorize' to finalize approval of the transaction with custom notes detailing your actions and savings tips.

Always explain your reasoning step-by-step.
`;

/**
 * Main Agent Loop running when a transaction is detected by MongoDB Change Stream.
 */
export async function runAgentLoop(transaction, io) {
  const transactionId = transaction._id.toString();
  
  // Helper function to send log updates to frontend
  const logThought = (msg) => {
    console.log(`[Agent Penny]: ${msg}`);
    io.emit('agent-thought', {
      transactionId,
      message: msg,
      timestamp: new Date()
    });
  };

  logThought(`🛎️ Detected new transaction event via MongoDB Change Stream.`);
  logThought(`Analyzing details: $${transaction.amount} at "${transaction.merchantRaw}"`);

  if (!process.env.GEMINI_API_KEY) {
    logThought(`⚠️ No GEMINI_API_KEY set. Simulating a mock reasoning loop.`);
    await simulateMockAgentLoop(transaction, io, logThought);
    return;
  }

  try {
    const model = ai.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION
    });

    // Define tools (function declarations)
    const checkBudgetTool = {
      name: "checkBudgetProgress",
      description: "Query the user's spending progress and budget limit for a specific category.",
      parameters: {
        type: "OBJECT",
        properties: {
          category: { 
            type: "STRING", 
            description: "The budget category, e.g. 'Food & Dining', 'Travel', 'Shopping', etc." 
          }
        },
        required: ["category"]
      }
    };

    const flagAnomalyTool = {
      name: "flagAnomaly",
      description: "Halt the transaction and flag it as an anomaly for human-in-the-loop verification.",
      parameters: {
        type: "OBJECT",
        properties: {
          reason: { type: "STRING", description: "The reason for flagging the transaction as anomalous." }
        },
        required: ["reason"]
      }
    };

    const approveAndCategorizeTool = {
      name: "approveAndCategorize",
      description: "Approve the transaction and categorize it in the system.",
      parameters: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", description: "The final matched category." },
          notes: { type: "STRING", description: "Empathy-driven savings tip or note for the user." }
        },
        required: ["category"]
      }
    };

    const getAgentContextTool = {
      name: "getAgentContext",
      description: "Query user profile balance, active subscriptions (name, cost, usage, status), and active goals.",
      parameters: { type: "OBJECT", properties: {} }
    };

    const createActionPlanTool = {
      name: "createActionPlan",
      description: "Register a multi-step action plan to cancel/renegotiate silent drains and shift money.",
      parameters: {
        type: "OBJECT",
        properties: {
          steps: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                type: { type: "STRING", enum: ["cancel", "negotiate", "transfer"] },
                target: { type: "STRING", description: "Name of target subscription or goal" },
                cost: { type: "NUMBER", description: "Monthly cost of subscription" },
                amount: { type: "NUMBER", description: "Amount of transfer" },
                description: { type: "STRING", description: "Clear explanation of this step" }
              },
              required: ["type", "target", "description"]
            }
          }
        },
        required: ["steps"]
      }
    };

    const cancelSubscriptionTool = {
      name: "cancelSubscription",
      description: "Cancel subscription to stop silent money drain.",
      parameters: {
        type: "OBJECT",
        properties: { name: { type: "STRING" } },
        required: ["name"]
      }
    };

    const renegotiateSubscriptionTool = {
      name: "renegotiateSubscription",
      description: "Initiate subscription renegotiation for a lower rate/discount.",
      parameters: {
        type: "OBJECT",
        properties: { name: { type: "STRING" } },
        required: ["name"]
      }
    };

    const moveMoneyToSavingsTool = {
      name: "moveMoneyToSavings",
      description: "Transfer money from Checking balance to a Savings goal bucket.",
      parameters: {
        type: "OBJECT",
        properties: {
          amount: { type: "NUMBER" },
          target: { type: "STRING" }
        },
        required: ["amount", "target"]
      }
    };

    // Initialize chat session with tools
    const chat = model.startChat({
      tools: [{
        functionDeclarations: [
          checkBudgetTool,
          flagAnomalyTool,
          approveAndCategorizeTool,
          getAgentContextTool,
          createActionPlanTool,
          cancelSubscriptionTool,
          renegotiateSubscriptionTool,
          moveMoneyToSavingsTool
        ]
      }]
    });

    // Prompt Gemini with transaction details
    const prompt = `
    New transaction received:
    - ID: ${transactionId}
    - Raw Merchant Name: "${transaction.merchantRaw}"
    - Vector Match Merchant Name: "${transaction.vectorMatchedMerchant || 'None'}"
    - Vector Match Category: "${transaction.vectorMatchedCategory || 'None'}"
    - Amount: $${transaction.amount}
    - Location: "${transaction.location || 'Unknown'}"
    
    Please run your complete Perceive-Reason-Plan-Act reasoning loop.
    1. First, call getAgentContext to perceive the user's accounts, active subscriptions, and savings goals.
    2. Call checkBudgetProgress to audit the category budget.
    3. If the transaction is an anomaly (amount > $500 or unusual location), use flagAnomaly to halt for review.
    4. If the transaction breaches a budget, identify any active subscriptions with "Low" or "None" usage (silent drains) from the context.
    5. Formulate and register a multi-step action plan using createActionPlan to cancel those silent drains and transfer savings to offset the breach.
    6. Execute the plan by calling cancelSubscription and/or moveMoneyToSavings as appropriate.
    7. Finally, call approveAndCategorize to approve the transaction with detailed notes.
    `;

    logThought(`🧠 Starting reasoning loop with Gemini...`);
    let response = await chat.sendMessage(prompt);
    
    // Process function calls loop (supports multi-step Tool Use)
    let functionCalls = response.functionCalls;
    while (functionCalls && functionCalls.length > 0) {
      for (const call of functionCalls) {
        const { name, args } = call;
        logThought(`🛠️ Gemini decided to execute tool: "${name}" with args: ${JSON.stringify(args)}`);

        let toolResult = null;
        if (name === "checkBudgetProgress") {
          const category = args.category;
          const db = getDB();
          const budgetsCol = db.collection('budgets');
          
          // Get limit
          const budgetDoc = await budgetsCol.findOne({ category });
          const limit = budgetDoc ? budgetDoc.limit : 200; // Default limit $200

          // Calculate current spent using Aggregation
          const spendStats = await getSpendAnalysis("user_default");
          const categorySpend = spendStats.find(s => s.category === category);
          const currentSpent = categorySpend ? categorySpend.totalSpent : 0;

          toolResult = {
            category,
            monthlyLimit: limit,
            currentSpent: currentSpent,
            exceeded: (currentSpent + transaction.amount) > limit
          };

          logThought(`📊 Tool execution result: Category '${category}' budget: $${currentSpent}/$${limit}. ` +
                     `New transaction will push total to $${currentSpent + transaction.amount}.`);
        } 
        else if (name === "flagAnomaly") {
          const db = getDB();
          const transactionsCol = db.collection('transactions');
          
          // Update transaction status to PENDING_REVIEW in MongoDB
          await transactionsCol.updateOne(
            { _id: transaction._id },
            { $set: { status: 'PENDING_REVIEW', anomalyReason: args.reason } }
          );

          toolResult = { status: "FLAGGED_SUCCESSFULLY", actionRequired: "HUMAN_IN_THE_LOOP_REVIEW" };
          logThought(`🚨 Transaction flagged as anomalous! Reason: "${args.reason}". Halting for user review.`);
          io.emit('anomaly-detected', { transactionId, amount: transaction.amount, merchant: transaction.merchantRaw, reason: args.reason });
        } 
        else if (name === "approveAndCategorize") {
          const db = getDB();
          const transactionsCol = db.collection('transactions');
          
          // Update transaction status to APPROVED in MongoDB
          await transactionsCol.updateOne(
            { _id: transaction._id },
            { $set: { status: 'APPROVED', category: args.category, notes: args.notes || "" } }
          );

          toolResult = { status: "APPROVED_AND_CATEGORIZED" };
          logThought(`✅ Transaction approved and categorized under '${args.category}'.`);
          if (args.notes) {
            logThought(`💬 Penny says: "${args.notes}"`);
          }
        }
        else if (name === "getAgentContext") {
          const db = getDB();
          const profile = await db.collection('profile').findOne({ userId: "user_default" });
          const subscriptions = await db.collection('subscriptions').find({ userId: "user_default" }).toArray();
          const goals = await db.collection('goals').find({ userId: "user_default" }).toArray();
          const savings = await db.collection('savings').find({ userId: "user_default" }).toArray();
          
          toolResult = {
            checkingBalance: profile ? profile.checkingBalance : 2450.00,
            subscriptions: subscriptions.map(s => ({ name: s.name, cost: s.cost, usage: s.usage, status: s.status })),
            goals: goals.map(g => ({ title: g.title, target: g.target, current: g.current })),
            savings: savings.map(s => ({ name: s.name, balance: s.balance }))
          };
          logThought(`📊 Tool execution result: Fetched profile. Checking: $${toolResult.checkingBalance}, Subscriptions: ${toolResult.subscriptions.length}, Goals: ${toolResult.goals.length}`);
        }
        else if (name === "createActionPlan") {
          const db = getDB();
          const planDoc = {
            userId: "user_default",
            transactionId,
            timestamp: new Date(),
            steps: args.steps.map(s => ({ ...s, status: 'pending' })),
            status: 'PENDING_EXECUTION'
          };
          const result = await db.collection('plans').insertOne(planDoc);
          toolResult = { status: "PLAN_CREATED", planId: result.insertedId.toString() };
          logThought(`📋 Generated Action Plan: ${args.steps.map(s => s.description).join(' -> ')}`);
        }
        else if (name === "cancelSubscription") {
          const db = getDB();
          const sub = await db.collection('subscriptions').findOne({ name: args.name, userId: "user_default" });
          const cost = sub ? sub.cost : 0;
          await db.collection('subscriptions').updateOne(
            { name: args.name, userId: "user_default" },
            { $set: { status: 'Cancelled' } }
          );
          await db.collection('actions').insertOne({
            userId: "user_default",
            actionType: "CANCEL",
            target: args.name,
            details: `Cancelled subscription to ${args.name} ($${cost}/mo) due to low usage.`,
            timestamp: new Date()
          });
          toolResult = { status: "SUBSCRIPTION_CANCELLED", subscription: args.name };
          logThought(`⚡ Acted: Cancelled subscription to "${args.name}"`);
        }
        else if (name === "renegotiateSubscription") {
          const db = getDB();
          await db.collection('subscriptions').updateOne(
            { name: args.name, userId: "user_default" },
            { $set: { status: 'Negotiating' } }
          );
          await db.collection('actions').insertOne({
            userId: "user_default",
            actionType: "NEGOTIATE",
            target: args.name,
            details: `Initiated discount renegotiation for ${args.name}.`,
            timestamp: new Date()
          });
          toolResult = { status: "NEGOTIATION_INITIATED", subscription: args.name };
          logThought(`⚡ Acted: Initiated negotiation for "${args.name}"`);
        }
        else if (name === "moveMoneyToSavings") {
          const db = getDB();
          const amount = parseFloat(args.amount);
          await db.collection('profile').updateOne(
            { userId: "user_default" },
            { $inc: { checkingBalance: -amount } }
          );
          await db.collection('savings').updateOne(
            { name: args.target, userId: "user_default" },
            { $inc: { balance: amount } }
          );
          await db.collection('goals').updateOne(
            { title: { $regex: new RegExp(args.target, 'i') }, userId: "user_default" },
            { $inc: { current: amount } }
          );
          await db.collection('actions').insertOne({
            userId: "user_default",
            actionType: "TRANSFER",
            target: args.target,
            details: `Transferred $${amount} from Checking to '${args.target}' savings bucket.`,
            timestamp: new Date()
          });
          toolResult = { status: "TRANSFER_SUCCESSFUL", amount, target: args.target };
          logThought(`⚡ Acted: Shifted $${amount} from Checking to '${args.target}' savings bucket.`);
        }

        // Send tool results back to Gemini to continue conversation
        response = await chat.sendMessage([{ functionResponse: { name, response: toolResult } }]);
      }
      functionCalls = response.functionCalls;
    }

    logThought(`🎯 Completed reasoning loop for transaction ${transactionId}.`);
  } catch (error) {
    logThought(`⚠️ Gemini API error: ${error.message || error}. Falling back to local agent loop for stability.`);
    await simulateMockAgentLoop(transaction, io, logThought);
  }
}

/**
 * Fallback simulation loop in case API key is missing.
 */
async function simulateMockAgentLoop(transaction, io, logThought) {
  const transactionId = transaction._id.toString();
  const db = getDB();
  const transactionsCol = db.collection('transactions');

  await new Promise(r => setTimeout(r, 1000));
  logThought(`🧠 Step 1: Matching merchant "${transaction.merchantRaw}" via Vector Search...`);
  
  let category = transaction.vectorMatchedCategory || "Shopping";
  let matchedName = transaction.vectorMatchedMerchant || transaction.merchantRaw;
  
  if (transaction.vectorMatchedCategory) {
    logThought(`🎯 Vector Match found: Resolved to standard merchant "${matchedName}" under category "${category}"`);
  } else {
    logThought(`❓ No vector match. Inferring category... Decided category: "${category}"`);
  }

  await new Promise(r => setTimeout(r, 1000));
  logThought(`📊 Step 2: Querying Aggregation Pipelines for monthly "${category}" budget...`);
  
  const budgetsCol = db.collection('budgets');
  const budgetDoc = await budgetsCol.findOne({ category });
  const limit = budgetDoc ? budgetDoc.limit : 200;
  
  const spendStats = await getSpendAnalysis("user_default");
  const categorySpend = spendStats.find(s => s.category === category);
  const currentSpent = categorySpend ? categorySpend.totalSpent : 0;
  const isOverBudget = (currentSpent + transaction.amount) > limit;

  logThought(`📊 Category spend: $${currentSpent} spent of $${limit} limit.`);

  await new Promise(r => setTimeout(r, 1000));
  logThought(`🛡️ Step 3: Assessing anomaly signals...`);

  if (transaction.amount > 500) {
    logThought(`🚨 Flagged Anomaly: Transaction amount $${transaction.amount} exceeds high-risk threshold ($500).`);
    await transactionsCol.updateOne(
      { _id: transaction._id },
      { $set: { status: 'PENDING_REVIEW', anomalyReason: "High-value transaction ($>500) requires verification" } }
    );
    io.emit('anomaly-detected', { 
      transactionId, 
      amount: transaction.amount, 
      merchant: transaction.merchantRaw, 
      reason: "Transaction amount exceeds high-risk threshold ($500)" 
    });
  } else {
    if (isOverBudget) {
      logThought(`⚠️ Budget breached! Formulating correction plan...`);
      await new Promise(r => setTimeout(r, 1000));
      
      // Perceive subscriptions
      const subscriptions = await db.collection('subscriptions').find({ userId: "user_default", status: "Active" }).toArray();
      let silentDrain = subscriptions.find(s => s.usage === "None");
      if (!silentDrain) {
        silentDrain = subscriptions.find(s => s.usage === "Low");
      }
      
      if (silentDrain) {
        logThought(`🧠 Identified silent money drain: "${silentDrain.name}" ($${silentDrain.cost}/mo) with usage "${silentDrain.usage}".`);
        
        // Plan
        const steps = [
          { type: 'cancel', target: silentDrain.name, cost: silentDrain.cost, description: `Cancel ${silentDrain.name} ($${silentDrain.cost}/mo) due to low usage` },
          { type: 'transfer', target: 'Summer Trip', amount: silentDrain.cost, description: `Transfer $${silentDrain.cost} ${silentDrain.name} savings to 'Summer Trip' goal` }
        ];
        
        const planDoc = {
          userId: "user_default",
          transactionId,
          timestamp: new Date(),
          steps: steps.map(s => ({ ...s, status: 'executed' })), // mark as executed since we run it autonomously
          status: 'EXECUTED'
        };
        await db.collection('plans').insertOne(planDoc);
        logThought(`📋 Generated Plan: Cancel ${silentDrain.name} -> Shift $${silentDrain.cost} to savings.`);
        await new Promise(r => setTimeout(r, 1000));
        
        // Act: cancel sub
        await db.collection('subscriptions').updateOne(
          { name: silentDrain.name, userId: "user_default" },
          { $set: { status: 'Cancelled' } }
        );
        await db.collection('actions').insertOne({
          userId: "user_default",
          actionType: "CANCEL",
          target: silentDrain.name,
          details: `Cancelled subscription to ${silentDrain.name} ($${silentDrain.cost}/mo) due to low usage.`,
          timestamp: new Date()
        });
        logThought(`⚡ Acted: Cancelled subscription to "${silentDrain.name}"`);
        await new Promise(r => setTimeout(r, 1000));
        
        // Act: move money
        await db.collection('profile').updateOne(
          { userId: "user_default" },
          { $inc: { checkingBalance: -silentDrain.cost } }
        );
        await db.collection('savings').updateOne(
          { name: "Summer Trip", userId: "user_default" },
          { $inc: { balance: silentDrain.cost } }
        );
        await db.collection('goals').updateOne(
          { title: "Save for Summer Trip", userId: "user_default" },
          { $inc: { current: silentDrain.cost } }
        );
        await db.collection('actions').insertOne({
          userId: "user_default",
          actionType: "TRANSFER",
          target: "Summer Trip",
          details: `Transferred $${silentDrain.cost} from Checking to 'Summer Trip' savings bucket.`,
          timestamp: new Date()
        });
        logThought(`⚡ Acted: Shifted $${silentDrain.cost} from Checking to 'Summer Trip' savings bucket.`);
      }
      
      const note = `Careful! You've spent $${currentSpent + transaction.amount} this month on ${category}, which is over your $${limit} limit. Penny autonomously cancelled your unused ${silentDrain.name} and shifted savings to goals.`;
      await transactionsCol.updateOne(
        { _id: transaction._id },
        { $set: { status: 'APPROVED', category, notes: note } }
      );
      logThought(`✅ Transaction approved. Categorized under: "${category}"`);
      logThought(`💬 Penny says: "${note}"`);
    } else {
      // Normal transaction
      const note = `Great job staying under budget! You have $${limit - (currentSpent + transaction.amount)} remaining in ${category}.`;
      await transactionsCol.updateOne(
        { _id: transaction._id },
        { $set: { status: 'APPROVED', category, notes: note } }
      );
      logThought(`✅ Transaction approved. Categorized under: "${category}"`);
      logThought(`💬 Penny says: "${note}"`);
    }
  }
}

/**
 * Chat advisor endpoint helper. Runs Gemini 2.5 Flash with live user financial context
 * or falls back to a smart rule-based financial advice generator.
 */
export async function runChatAdvisor(userMessage) {
  const db = getDB();
  try {
    const profile = await db.collection('profile').findOne({ userId: "user_default" });
    const checkingBalance = profile ? profile.checkingBalance : 2450.00;
    
    const budgets = await db.collection('budgets').find().toArray();
    const spendAnalysis = await getSpendAnalysis("user_default");
    const mergedBudgets = budgets.map(b => {
      const spend = spendAnalysis.find(s => s.category === b.category);
      return { 
        category: b.category, 
        limit: b.limit, 
        spent: spend ? spend.totalSpent : 0 
      };
    });
    
    const subscriptions = await db.collection('subscriptions').find({ userId: "user_default" }).toArray();
    const goals = await db.collection('goals').find({ userId: "user_default" }).toArray();
    const actions = await db.collection('actions').find({ userId: "user_default" }).sort({ timestamp: -1 }).limit(5).toArray();

    const financialContext = {
      checkingBalance,
      budgets: mergedBudgets,
      subscriptions: subscriptions.map(s => ({ name: s.name, cost: s.cost, status: s.status, usage: s.usage })),
      goals: goals.map(g => ({ title: g.title, target: g.target, current: g.current })),
      recentActions: actions.map(a => `${a.actionType}: ${a.details}`)
    };

    const systemInstruction = `You are "Penny", an empathetic, intelligent personal finance AI guardian. 
You have access to the user's live financial data:
${JSON.stringify(financialContext, null, 2)}

Provide a concise, helpful, and friendly response to the user's message. Focus on helping them save money, budget better, and explaining any recent actions like cancellations or transfers. Keep it short (under 3 sentences) and highly actionable.`;

    if (process.env.GEMINI_API_KEY && ai) {
      try {
        const model = ai.getGenerativeModel({
          model: "gemini-2.5-flash",
          systemInstruction
        });
        const result = await model.generateContent(userMessage);
        return result.response.text();
      } catch (e) {
        console.error("Gemini Chat API Error, falling back:", e.message || e);
      }
    }

    // Smart rule-based fallback
    const msg = userMessage.toLowerCase();
    if (msg.includes('balance') || msg.includes('checking') || msg.includes('how much money') || msg.includes('cash')) {
      return `Hi! You currently have $${checkingBalance.toFixed(2)} in your checking account, and $${goals.reduce((sum, g) => sum + g.current, 0)} saved toward your financial goals.`;
    }
    
    if (msg.includes('budget') || msg.includes('limit') || msg.includes('spent') || msg.includes('over')) {
      const over = mergedBudgets.filter(b => b.spent > b.limit);
      if (over.length > 0) {
        return `You're currently over budget in: ${over.map(o => o.category).join(', ')}. I recommend executing your active Action Plan to cancel silent drains and offset this deficit.`;
      }
      const travel = mergedBudgets.find(b => b.category === "Travel");
      const travelLeft = travel ? (travel.limit - travel.spent) : 0;
      return `Your budgets are looking good! You have $${travelLeft.toFixed(2)} remaining in your Travel budget.`;
    }
    
    if (msg.includes('subscription') || msg.includes('drain') || msg.includes('cancel') || msg.includes('netflix') || msg.includes('gym')) {
      const active = subscriptions.filter(s => s.status === 'Active');
      const low = active.filter(s => s.usage === 'None' || s.usage === 'Low');
      if (low.length > 0) {
        return `You have ${low.length} active subscriptions with low usage (${low.map(s => s.name).join(', ')}). Canceling them will save you $${low.reduce((sum, s) => sum + s.cost, 0)} every month!`;
      }
      return `All your active subscriptions ($${active.reduce((sum, s) => sum + s.cost, 0).toFixed(2)}/mo total) show high usage. Good job avoiding wasted spend!`;
    }
    
    if (msg.includes('goal') || msg.includes('save') || msg.includes('saving') || msg.includes('trip') || msg.includes('summer')) {
      const summerGoal = goals.find(g => g.title.toLowerCase().includes('summer'));
      const amt = summerGoal ? summerGoal.current : 0;
      return `Your 'Save for Summer Trip' goal is at $${amt} of $500. We recently boosted this with a $50 transfer from your Gym Membership cancellation!`;
    }

    if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey') || msg.includes('penny')) {
      return `Hello! I'm Penny, your personal finance AI guardian. You can ask me about your balance, budgets, active subscriptions, or savings goals!`;
    }

    return `I am analyzing your financial portfolio. Your checking balance is $${checkingBalance.toFixed(2)}, and your total budget limit is $${mergedBudgets.reduce((sum, b) => sum + b.limit, 0)}. What specific advice do you need?`;
  } catch (error) {
    return `Sorry, I hit a snag checking your details. But I'm here to help protect your hard-earned pennies!`;
  }
}

