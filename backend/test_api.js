import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
console.log('Using API Key:', apiKey ? 'FOUND' : 'MISSING');

const genAI = new GoogleGenerativeAI(apiKey);

async function run() {
  const models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"];
  for (const m of models) {
    try {
      console.log(`Testing model: ${m}...`);
      const model = genAI.getGenerativeModel({ model: m });
      const result = await model.generateContent("Say hello");
      console.log(`${m} response:`, result.response.text());
    } catch (err) {
      console.error(`${m} failed:`, err.message);
    }
  }
}

run();
