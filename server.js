const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

// =================================================================
// === ==> YAHAN DHYAAN DEIN: Service Key ko Environment Variable se load karna <== ===
// =================================================================
const admin = require('firebase-admin');

// Step 1: Render.com se environment variable ko padhein
const serviceAccount_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;

// Step 2: Check karein ki variable set hai ya nahi
if (!serviceAccount_JSON) {
    console.error("FATAL ERROR: The FIREBASE_SERVICE_ACCOUNT environment variable is not set on Render.com.");
    console.error("Please add it in your service's 'Environment' tab.");
    process.exit(1); // Server ko band kar dein agar key nahi hai
}

// Step 3: JSON string ko object mein convert karein
const serviceAccount = JSON.parse(serviceAccount_JSON);
// =================================================================


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore(); // Firestore database ka reference

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Daily limit yahan set karein
const DAILY_LIMIT = 20;

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

// /api/generate with Limit Check Activated
app.post('/api/generate', async (req, res) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
        return res.status(401).send({ error: "Authentication token nahi mila." });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const today = new Date().toISOString().split('T')[0];
        const usageDocRef = db.collection('usageLimits').doc(uid);
        const doc = await usageDocRef.get();

        if (doc.exists && doc.data().date === today && doc.data().count >= DAILY_LIMIT) {
            return res.status(429).send({ error: `Aapki aaj ki free limit (${DAILY_LIMIT} messages) poori ho gayi hai.` });
        }

        const { contents, systemInstruction } = req.body;
        if (!contents) return res.status(400).json({ error: 'Request body must contain "contents".' });
        
        const currentApiKey = getNextApiKey();
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${currentApiKey}`;
        const payload = { contents, ...(systemInstruction && { systemInstruction }) };
        
        const response = await axios.post(apiUrl, payload);
        const textResponse = response.data.candidates[0].content.parts[0].text;
        
        const currentCount = (doc.exists && doc.data().date === today) ? doc.data().count : 0;
        await usageDocRef.set({
            date: today,
            count: currentCount + 1
        }, { merge: true });
        
        res.json({ text: textResponse });

    } catch (error) {
        console.error('Error in /api/generate:', error.message);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).send({ error: "Session expire ho gaya, कृपया dobara login karein." });
        }
        res.status(500).json({ error: 'Failed to get response from AI model.' });
    }
});

// Image Generation Endpoint with the SAME Limit
app.post('/api/generate-image', async (req, res) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
        return res.status(401).send({ error: "Authentication token nahi mila." });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const today = new Date().toISOString().split('T')[0];
        const usageDocRef = db.collection('usageLimits').doc(uid);
        const doc = await usageDocRef.get();

        if (doc.exists && doc.data().date === today && doc.data().count >= DAILY_LIMIT) {
            return res.status(429).send({ error: `Aapki aaj ki free limit (${DAILY_LIMIT} messages/images) poori ho gayi hai.` });
        }

        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Request body must contain "prompt".' });

        const currentApiKey = getNextApiKey();
        // NOTE: Make sure your image generation logic/API call is correct here.
        // This is a placeholder for your actual image generation logic.
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${currentApiKey}`, {
             instances: { prompt: prompt },
             parameters: { "sampleCount": 1 }
        });

        const generatedImageBase64 = response.data.predictions[0].bytesBase64Encoded;
        
        const currentCount = (doc.exists && doc.data().date === today) ? doc.data().count : 0;
        await usageDocRef.set({
            date: today,
            count: currentCount + 1
        }, { merge: true });

        res.json({ base64Image: generatedImageBase64 });

    } catch (error) {
        console.error('Error in /api/generate-image:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).json({ error: 'Failed to generate image.' });
    }
});


// === Static File Serving ===
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Ravi AI server is running on port ${port}`);
});
