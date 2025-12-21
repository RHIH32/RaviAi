const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

// --- Firebase Admin SDK Setup (Optional: Error se bachne ke liye try-catch mein) ---
const admin = require('firebase-admin');

try {
    // Agar environment variable set hai tabhi Firebase init karein
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin initialized successfully.");
    } else {
        console.log("Warning: FIREBASE_SERVICE_ACCOUNT not set. Database features won't work.");
    }
} catch (error) {
    console.error("Firebase Init Error:", error.message);
}
// ------------------------------------

const app = express();
const port = process.env.PORT || 3000;

// === 1. STRONG CORS SETUP (Sabse Zaroori) ===
app.use(cors({
    origin: '*', // Sabhi websites ko allow karein
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Preflight Requests ko explicitly handle karein
app.options('*', (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(200);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- API Key Configuration ---
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [];
let currentKeyIndex = 0;

function getNextApiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        // Agar key nahi hai to error mat phenko, bas log karo (Server crash hone se bachega)
        console.error("No Gemini API keys found.");
        return null;
    }
    const key = GEMINI_API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
    return key;
}

// === API: TEXT GENERATION ===
app.post('/api/generate', async (req, res) => {
    try {
        const { contents, systemInstruction } = req.body;
        if (!contents) {
            return res.status(400).json({ error: 'Request body must contain "contents".' });
        }
        
        const currentApiKey = getNextApiKey();
        if (!currentApiKey) {
            return res.status(500).json({ error: "Server API Key configuration error." });
        }

        // SUDHAR: Model ka naam 'gemini-1.5-flash' karein (2.5 exist nahi karta)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${currentApiKey}`;

        const payload = { contents, ...(systemInstruction && { systemInstruction }) };
        
        const response = await axios.post(apiUrl, payload);
        
        // Response check karein
        if(response.data && response.data.candidates && response.data.candidates.length > 0) {
             const textResponse = response.data.candidates[0].content.parts[0].text;
             res.json({ text: textResponse });
        } else {
             throw new Error("Invalid response from Gemini API");
        }

    } catch (error) {
        console.error('Error in /api/generate:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to get response from AI model.' });
    }
});

// === API: IMAGE GENERATION (Isse Khali mat chhodiye) ===
app.post('/api/generate-image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "Prompt is required" });
        }

        // Hum HuggingFace ka free model use kar rahe hain (Stable Diffusion)
        // Agar aapke paas apni API key hai to process.env.HF_API_KEY use karein
        const HF_API_KEY = process.env.HF_API_KEY; 
        
        // Agar key nahi hai, tab bhi try karein (kabhi kabhi free chalta hai)
        const headers = HF_API_KEY ? { Authorization: `Bearer ${HF_API_KEY}` } : {};

        const response = await axios.post(
            "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
            { inputs: prompt },
            { 
                headers: headers,
                responseType: 'arraybuffer' // Image binary data ke liye zaroori hai
            }
        );

        // Buffer ko Base64 mein convert karein
        const base64Image = Buffer.from(response.data, 'binary').toString('base64');
        res.json({ base64Image: base64Image });

    } catch (error) {
        console.error("Image Gen Error:", error.message);
        res.status(500).json({ error: "Image generation failed" });
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
