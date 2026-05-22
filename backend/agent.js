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
Your goal is to process incoming financial transactions and make decisions. 

For each transaction, you must follow this multi-step reasoning protocol:
1. **Analyze**: Evaluate the merchant, amount, and location.
2. **Merchant Match & Categorization**: Check if the merchant has a resolved category. If not, determine the most logical category (e.g., Food & Dining, Shopping, Travel, Entertainment, Utilities, Groceries).
3. **Budget Check**: Check how this transaction impacts the monthly budget for that category.
4. **Anomalies / Fraud Check**: Look for suspicious signs (e.g., unusually large amount, duplicate charges, or suspicious merchant description).
5. **Decide & Action**: 
   - If normal: Approve and categorize.
   - If over-budget: Approve but trigger a budget limit alert.
   - If suspicious: Flag as anomaly and halt for Human-in-the-loop review.

You have access to tools. You MUST use these tools to check budgets and register your decisions.
Always explain your thoughts step-by-step.
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

    // Initialize chat session with tools
    const chat = model.startChat({
      tools: [{ functionDeclarations: [checkBudgetTool, flagAnomalyTool, approveAndCategorizeTool] }]
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
    
    Please run your reasoning loop. If you see vector match category, start with that.
    Use checkBudgetProgress to inspect spending limits before approving.
    If amount is > $500 or location is unusual compared to user default, use flagAnomaly.
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

        // Send tool results back to Gemini to continue conversation
        response = await chat.sendMessage([{ functionResponse: { name, response: toolResult } }]);
      }
      functionCalls = response.functionCalls;
    }

    logThought(`🎯 Completed reasoning loop for transaction ${transactionId}.`);
  } catch (error) {
    logThought(`❌ Error during agent execution: ${error.message}`);
    console.error(error);
  }
}

/**
 * Fallback simulation loop in case API key is missing.
 */
async function simulateMockAgentLoop(transaction, io, logThought) {
  const transactionId = transaction._id.toString();
  const db = getDB();
  const transactionsCol = db.collection('transactions');

  await new Promise(r => setTimeout(r, 1500));
  logThought(`🧠 Step 1: Matching merchant "${transaction.merchantRaw}" via Vector Search...`);
  
  let category = transaction.vectorMatchedCategory || "Shopping";
  let matchedName = transaction.vectorMatchedMerchant || transaction.merchantRaw;
  
  if (transaction.vectorMatchedCategory) {
    logThought(`🎯 Vector Match found: Resolved to standard merchant "${matchedName}" under category "${category}"`);
  } else {
    logThought(`❓ No vector match. Inferring category... Decided category: "${category}"`);
  }

  await new Promise(r => setTimeout(r, 1500));
  logThought(`📊 Step 2: Querying Aggregation Pipelines for monthly "${category}" budget...`);
  
  const budgetsCol = db.collection('budgets');
  const budgetDoc = await budgetsCol.findOne({ category });
  const limit = budgetDoc ? budgetDoc.limit : 200;
  
  const spendStats = await getSpendAnalysis("user_default");
  const categorySpend = spendStats.find(s => s.category === category);
  const currentSpent = categorySpend ? categorySpend.totalSpent : 0;
  const isOverBudget = (currentSpent + transaction.amount) > limit;

  logThought(`📊 Category spend: $${currentSpent} spent of $${limit} limit.`);

  await new Promise(r => setTimeout(r, 1500));
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
    // Approve
    const note = isOverBudget 
      ? `Careful! You've spent $${currentSpent + transaction.amount} this month on ${category}, which is over your $${limit} limit.`
      : `Great job staying under budget! You have $${limit - (currentSpent + transaction.amount)} remaining in ${category}.`;
      
    await transactionsCol.updateOne(
      { _id: transaction._id },
      { $set: { status: 'APPROVED', category, notes: note } }
    );
    logThought(`✅ Transaction approved. Categorized under: "${category}"`);
    logThought(`💬 Penny says: "${note}"`);
  }
}
