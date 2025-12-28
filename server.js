const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

// --- Firebase Admin SDK Setup ---
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const DAILY_LIMIT = 20;
// ------------------------------------

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// --- API Key Configuration ---
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [];
let currentKeyIndex = 0;

function getNextApiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error("No Gemini API keys found in .env file.");
    }
    const key = GEMINI_API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
    return key;
}

if (GEMINI_API_KEYS.length === 0) {
    console.error("FATAL ERROR: GEMINI_API_KEYS environment variable is not set correctly.");
    process.exit(1);
}

// === ✅ SMART /api/generate (Auto Search + Auto Image) ===
app.post('/api/generate', async (req, res) => {
    try {
        const { contents, systemInstruction, isDeepResearch } = req.body;
        
        if (!contents) {
            return res.status(400).json({ error: 'Request body must contain "contents".' });
        }

        // User ka latest message nikalo
        const lastMessagePart = contents[contents.length - 1]?.parts[0];
        let userText = "";
        
        if (lastMessagePart && lastMessagePart.text) {
            userText = lastMessagePart.text.toLowerCase();
        }

        // --- 1. IMAGE GENERATION CHECK (Quota Saver) ---
        try {
            if (userText) {
                const isImageRequest = 
                    (userText.includes("image") || userText.includes("photo") || userText.includes("tasveer") || userText.includes("picture") || userText.includes("drawing") || userText.includes("sketch")) &&
                    (userText.includes("create") || userText.includes("generate") || userText.includes("make") || userText.includes("draw") || userText.includes("banao") || userText.includes("dikhao"));

                if (isImageRequest) {
                    console.log("🎨 Image request detected! Skipping Gemini.");
                    const fakeGeminiResponse = JSON.stringify({
                        action: "generate_image",
                        prompt: lastMessagePart.text,
                        response: "Haan zaroor! Main aapke liye ye tasveer bana raha hoon... 🎨"
                    });
                    return res.json({ text: fakeGeminiResponse });
                }
            }
        } catch (checkError) { console.error(checkError); }

        // --- 2. SMART SEARCH DETECTION (Auto Internet) ---
        // Agar user ne Toggle ON kiya hai, TOH search karega hi.
        // LEKIN agar Toggle OFF hai, tab bhi hum check karenge ki kya search zaroori hai?
        
        let enableGoogleSearch = isDeepResearch; // Default: Jo user ne frontend se bheja

        if (!enableGoogleSearch && userText) {
            // In shabdon se pata chalega ki user ko TAZA jaankari chahiye
            const searchTriggers = [
                "news", "khabar", "samachar",    // News
                "weather", "mausam", "temperature", // Weather
                "score", "match", "cricket", "live", // Sports
                "price", "rate", "bhav", "kemat", "share market", // Finance
                "latest", "current", "abhi", "aaj", "today", "now", // Time-based
                "kaun hai", "who is", "kya hai", "what is", // General queries (Optional, can remove if too sensitive)
                "search", "dhundo", "google" // Direct command
            ];

            // Check karein agar koi keyword match hota hai
            if (searchTriggers.some(keyword => userText.includes(keyword))) {
                console.log("🌍 Auto-Search Triggered: User asked for live info.");
                enableGoogleSearch = true;
            }
        }

        // --- 3. CALL GEMINI API ---
        const currentApiKey = getNextApiKey();
        
        // Google Search Tool Configuration
        let tools = [];
        if (enableGoogleSearch) {
            tools = [{ googleSearch: {} }];
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentApiKey}`;        
        const payload = { 
            contents, 
            ...(systemInstruction && { systemInstruction }),
            ...(enableGoogleSearch && { tools: tools }) // Tool tabhi add hoga jab zaroorat ho
        };
        
        const response = await axios.post(apiUrl, payload);
        
        const candidate = response.data.candidates[0];
        let textResponse = "";

        if (candidate.content && candidate.content.parts) {
            textResponse = candidate.content.parts.map(part => part.text || "").join("");
        }
        
        // Search Results ka citation (reference) agar mile to use ignore kar sakte hain ya format kar sakte hain
        // Gemini automatically answer me integrate kar deta hai.

        res.json({ text: textResponse });

    } catch (error) {
        console.error('Error in /api/generate:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to get response from AI model.' });
    }
});

// === API: IMAGE GENERATION (Pollinations.ai - Free & No Key) ===
app.post('/api/generate-image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "Prompt is required" });
        }

        console.log("Generating image for:", prompt);

        // 1. Pollinations AI ka URL
        const seed = Math.floor(Math.random() * 10000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1024&height=1024&nologo=true&model=flux`; // Model flux kar diya better quality ke liye

        // 2. Image ko download karein
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

        // 3. Image ko Base64 mein convert karein
        const base64Image = Buffer.from(response.data, 'binary').toString('base64');

        // 4. Frontend ko bhej dein
        res.json({ 
            base64Image: base64Image,
            imageUrl: imageUrl 
        });

    } catch (error) {
        console.error("Image Gen Error:", error.message);
        res.status(500).json({ error: "Image generation failed. Try again." });
    }
});

// === Static File Serving ===
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Ravi AI server is running at http://localhost:${port}`);
});


