import { reportDay } from '../../src/utils/reporting';
import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { loadStateFromNormalized } from '../db';

const router = Router();

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    console.log('Gemini AI Client successfully initialized in modular router.');
  } catch (err) {
    console.error('Error initializing Gemini AI SDK client in modular router:', err);
  }
}

// 1. Demand Forecasting API
router.post('/forecast', async (req, res) => {
  const dbState = await loadStateFromNormalized();
  const products = dbState?.products || [];
  const transactions = dbState?.transactions || [];

  if (!ai) {
    return res.json({
      success: false,
      error: 'GEMINI_API_KEY_MISSING',
      advice: 'The server-side GEMINI_API_KEY environment variable is not defined in Secrets settings. Please apply a valid key to see custom real-time predictions. Returning default advisory analytical sandbox projection.',
      aiMarkdownMarkdown: `### ⚠️ AI Engine Running in Sandbox Mode

Please provide your **GEMINI_API_KEY** in the Secrets panel to activate live hardware demand forecasting.

#### 📊 General Hardware Trends (Advisory Simulation):
1. **Seasonal Surge (Construction Materials)**: Portland cement and Red bricks have a predictable summer spike up to **35% additional demand** because outdoor projects double. Auto-reorder level is advised to adjust +15%.
2. **Plumbing Accessories**: PVC valves are highly inelastic but require a higher safety factor due to low supplier frequency.
3. **Paints**: Outdoor white shielding paint has high correlation with weekend sunny forecasts.`
    });
  }

  try {
    const historicalOverview = transactions.map(t => ({
      date: reportDay(t.date),
      total: t.total,
      itemCount: t.items.reduce((acc: number, it: any) => acc + it.quantity, 0),
      items: t.items.map((it: any) => `${it.productName} (Qty: ${it.quantity})`).join(', ')
    }));

    const catalogDetails = products.map(p => ({
      name: p.name,
      category: p.category,
      currentQty: p.quantity,
      reorderLevel: p.reorderLevel,
      sellingPrice: p.sellingPrice
    }));

    const prompt = `You are a professional business intelligence predictive strategist specializing in retail hardware store management.
Analyze our transactional sales logs and product listing data to generate a detailed predictive report. Our current local time is ${new Date().toISOString()}.

DATASET:
---
SALES TRANSACTIONS (Last 14 days):
${JSON.stringify(historicalOverview.slice(0, 50), null, 2)}

CATALOG STATUS:
${JSON.stringify(catalogDetails.slice(0, 50), null, 2)}
---

Generate an executive business intelligence breakdown. It MUST be returned in elegant Markdown. Include:
1. **Market Demand Forecast**: Focus on specific products with intense sales spikes or low stock levels.
2. **Category Growth Trends**: Construction vs Tools vs Paints project behavior for the summer season starting now in 2026.
3. **Smart Stock Safety Predictions**: Flag specific SKUs where inventory may soon hit zero.
4. **Actionable Suggestions**: Provide a succinct list of 3-4 structural reorders that the manager should complete immediately.
Keep the advice highly sharp and grounded strictly in the provided logs. Keep the language direct, informative and useful without placeholders.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });

    const aiMarkdownMarkdown = response.text || 'Predictive model generated an empty response. Please retry.';

    res.json({
      success: true,
      aiMarkdownMarkdown
    });
  } catch (error: any) {
    console.error('Gemini prediction error:', error);
    res.status(500).json({ error: 'AI Prediction failed', details: error.message });
  }
});

// 2. Smart Stock Advice / Reorder Advisor API
router.post('/reorder-suggestions', async (req, res) => {
  const dbState = await loadStateFromNormalized();
  const products = dbState?.products || [];
  const lowStockProducts = products.filter(p => p.quantity <= p.reorderLevel);

  if (!ai) {
    return res.json({
      success: false,
      error: 'GEMINI_API_KEY_MISSING',
      suggestions: lowStockProducts.map(p => ({
        productId: p.id,
        name: p.name,
        currentQty: p.quantity,
        reorderLevel: p.reorderLevel,
        suggestedQty: Math.max(10, p.reorderLevel * 2),
        priority: p.quantity === 0 ? 'CRITICAL' : 'HIGH',
        reason: 'Manual safety formula calculation: low supply'
      }))
    });
  }

  try {
    const prompt = `You are an inventory optimization engine for a heavy-duty hardware shop.
Given the current set of products that are under or approaching their warning reorder level, recommend a specific suggested order quantity and a priority ('CRITICAL', 'HIGH', 'MEDIUM').
Provide logic for each suggestion based on typical construction/builder cycles.

LOW STOCK ITEMS FOR AUDIT ANALYSIS:
${JSON.stringify(lowStockProducts.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      currentQty: p.quantity,
      reorderLevel: p.reorderLevel,
      brand: p.brand
    })), null, 2)}

Return a strict, valid JSON array containing EXACTLY objects matching the following JSON schema:
[
  {
    "productId": "string",
    "name": "string",
    "suggestedQty": 12,
    "priority": "CRITICAL" | "HIGH" | "MEDIUM",
    "reason": "string describing why this amount is ideal for this product"
  }
]
Do not wrap in markdown tags or include any text other than the pure JSON string.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productId: { type: Type.STRING },
              name: { type: Type.STRING },
              suggestedQty: { type: Type.INTEGER },
              priority: { type: Type.STRING },
              reason: { type: Type.STRING }
            },
            required: ['productId', 'name', 'suggestedQty', 'priority', 'reason']
          }
        }
      }
    });

    const parsed = JSON.parse(response.text || '[]');
    res.json({
      success: true,
      suggestions: parsed
    });
  } catch (error: any) {
    console.error('Gemini reorder logic failure:', error);
    res.json({
      success: false,
      suggestions: lowStockProducts.map(p => ({
        productId: p.id,
        name: p.name,
        currentQty: p.quantity,
        reorderLevel: p.reorderLevel,
        suggestedQty: Math.max(15, p.reorderLevel * 3 - p.quantity),
        priority: p.quantity === 0 ? 'CRITICAL' : 'HIGH',
        reason: 'Automated fallback optimization: replenishment safeguard active'
      }))
    });
  }
});

// 3. Complementary Product Purchase Predictor (Checkout helper)
router.post('/predict-complementary', async (req, res) => {
  const { currentCartIds } = req.body;
  if (!currentCartIds || currentCartIds.length === 0) {
    return res.json({ suggestions: [] });
  }

  const dbState = await loadStateFromNormalized();
  const products = dbState?.products || [];
  const itemsInCart = products.filter(p => currentCartIds.includes(p.id));

  if (!ai) {
    const rulesCross: Record<string, string[]> = {
      'Construction Materials': ['Tools', 'Safety Equipment'],
      'Plumbing': ['Tools'],
      'Electrical': ['Tools'],
      'Paints': ['Tools', 'Paints'],
      'Tools': ['Safety Equipment']
    };

    const categoriesInCart = [...new Set(itemsInCart.map(i => i.category as string))];
    const targetCategories = categoriesInCart.flatMap(cat => rulesCross[cat as string] || ['Tools']);

    const suggestions = products
      .filter(p => !currentCartIds.includes(p.id) && targetCategories.includes(p.category))
      .slice(0, 3)
      .map(p => ({
        productId: p.id,
        name: p.name,
        sellingPrice: p.sellingPrice,
        reason: `Frequently purchased with items in your cart (${p.category} essentials)`
      }));

    return res.json({ success: false, suggestions });
  }

  try {
    const prompt = `You are a Sales recommendation engine for a builder's depot hardware store.
The customer currently has these items in their grocery card:
${JSON.stringify(itemsInCart.map(p => ({ name: p.name, category: p.category })), null, 2)}

Our remaining hardware catalog comprises:
${JSON.stringify(products.filter(p => !currentCartIds.includes(p.id)).map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      sellingPrice: p.sellingPrice
    })), null, 2)}

Suggest EXACTLY up to 3 complementary products from the remaining catalog that would be highly useful for the target contractor/DIY customer. (e.g. if buying Cement -> recommend bricks or safety gloves; if buying paint -> recommend a paint brush).
Return a strict JSON array containing objects matching this schema:
[
  {
    "productId": "string",
    "name": "string",
    "sellingPrice": 12.50,
    "reason": "short explanation of why this matches the active cart"
  }
]
Do not wrap in markdown coding tags.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productId: { type: Type.STRING },
              name: { type: Type.STRING },
              sellingPrice: { type: Type.NUMBER },
              reason: { type: Type.STRING }
            },
            required: ['productId', 'name', 'sellingPrice', 'reason']
          }
        }
      }
    });

    const parsed = JSON.parse(response.text || '[]');
    res.json({
      success: true,
      suggestions: parsed
    });
  } catch (error) {
    res.json({ success: false, suggestions: [] });
  }
});

// 4. Interactive AI Chat Assistant Endpoint
router.post('/chat', async (req, res) => {
  const { message, history } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  const dbState = await loadStateFromNormalized();
  const products = dbState?.products || [];
  const lowStockProducts = products.filter(p => p.quantity <= p.reorderLevel);
  const currency = dbState?.settings?.currency || 'LKR';

  if (!ai) {
    // Provide a simple rule-based mock response in sandbox mode
    const msg = message.toLowerCase();
    let reply = "I am currently running in Offline Sandbox Mode because the `GEMINI_API_KEY` is missing from the server environment. How can I help you with manual computations?";
    if (msg.includes('hello') || msg.includes('hi')) {
      reply = "Hello! I am your Lanka Smart Hardware offline chatbot assistant. How can I help you today?";
    } else if (msg.includes('low stock') || msg.includes('reorder')) {
      reply = `Here is the offline reorder list. We currently have ${lowStockProducts.length} low-stock products:\n` + 
        lowStockProducts.map(p => `- ${p.name} (Qty: ${p.quantity}, Reorder Level: ${p.reorderLevel})`).join('\n');
    } else if (msg.includes('products') || msg.includes('catalog')) {
      reply = `We have ${products.length} products in our catalog. Top items:\n` +
        products.slice(0, 5).map(p => `- ${p.name} (Price: ${currency} ${p.sellingPrice.toFixed(2)})`).join('\n');
    }
    return res.json({ success: true, response: reply });
  }

  try {
    const catalogContext = products.slice(0, 30).map(p => ({
      name: p.name,
      sku: p.sku,
      category: p.category,
      price: p.sellingPrice,
      qty: p.quantity,
      reorder: p.reorderLevel
    }));

    const lowStockContext = lowStockProducts.slice(0, 15).map(p => ({
      name: p.name,
      qty: p.quantity,
      reorder: p.reorderLevel
    }));

    const systemInstruction = `You are the Lanka Smart Hardware POS AI Assistant, a friendly and experienced AI helper.
Your job is to assist store managers, cashiers, and inventory officers with calculations, stock lookups, and store operations.
Here is the current hardware catalog (first 30 items):
${JSON.stringify(catalogContext, null, 2)}

Here are the low stock products currently:
${JSON.stringify(lowStockContext, null, 2)}

Provide helpful, direct answers. Keep them concise and clear. Use bullet points or lists where appropriate. Mention currency as ${currency} when talking about prices. If the user asks for builders' calculations (tiles, paint, cement volume, steel weight), perform the math step-by-step and give the final required materials.`;

    // Process history: map client history format to Gemini format
    const contents = Array.isArray(history) ? history.map((h: any) => ({
      role: h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.content || '' }]
    })) : [];

    // Append current user message
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: contents,
      config: {
        systemInstruction: systemInstruction
      }
    });

    const replyText = response.text || "I'm sorry, I couldn't formulate a response. Please try again.";
    res.json({
      success: true,
      response: replyText
    });
  } catch (error: any) {
    console.error('Gemini Chat error:', error);
    res.status(500).json({ error: 'Gemini Chat failed', details: error.message });
  }
});

export default router;
