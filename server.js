const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Firebase Admin SDK Setup
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

console.log("Server is using Firebase project:", serviceAccount.project_id);

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

// === AI API Endpoints ===
app.post('/api/generate', async (req, res) => {
    console.log("--- New Request Received ---");
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        console.log("Error: Frontend se token nahi mila.");
        return res.status(401).send({ error: "Authentication token nahi mila." });
    }

    console.log("Token mila. Ab verify karne ki koshish kar rahe hain...");

    try {
        // Step 1: Token ko verify karein (Yeh security ke liye zaroori hai)
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        console.log("Token verification SAFAL. UID:", decodedToken.uid);

        // Limit check karne wala code yahan se hata diya gaya hai

        console.log("User authenticated. Ab Gemini API ko call kar rahe hain...");
        const { contents, systemInstruction } = req.body;
        if (!contents) {
            return res.status(400).json({ error: 'Request body must contain "contents".' });
        }
        
        const currentApiKey = getNextApiKey();
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${currentApiKey}`;
        
        const safetySettings = [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ];
        const payload = { contents, safetySettings, ...(systemInstruction && { systemInstruction }) };
        
        const response = await axios.post(apiUrl, payload);

        if (!response.data.candidates || response.data.candidates.length === 0) {
            console.error("Gemini API returned no candidates.");
            return res.status(500).json({ error: "AI model ne response generate nahi kiya." });
        }
        const textResponse = response.data.candidates[0].content.parts[0].text;
        
        console.log("Gemini se response mil gaya.");
        
        // Limit update karne wala code bhi yahan se hata diya gaya hai
        
        res.json({ text: textResponse });

    } catch (error) {
        console.error("!!! TOKEN VERIFICATION FAIL HUA YA KOI AUR ERROR AAYA !!!");
        console.error("Error Code:", error.code);
        console.error("Error Message:", error.message);

        return res.status(401).send({ 
            error: "Token verification fail ho gaya.", 
            details: `Error code: ${error.code}`
        });
    }
});

// Image Generation Endpoint
app.post('/api/generate-image', async (req, res) => {
    // ... (generate-image ka code waisa hi rahega) ...
});

// === Static File Serving ===
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Ravi AI server is running at http://localhost:${port}`);
});
