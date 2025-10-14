const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

// NAYA: Firebase Admin SDK ko setup karna zaroori hai
const admin = require('firebase-admin');
// YEH FILE AAPKO APNE FIREBASE PROJECT SE DOWNLOAD KARNI HOGI
const serviceAccount = require('./firebase-service-account-key.json');

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

// NAYA: Daily limit yahan set karein
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

// UPDATED: /api/generate with Limit Check Activated
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

        // UNCOMMENT KIYA GAYA: Limit check ab kaam karega
        if (doc.exists && doc.data().date === today && doc.data().count >= DAILY_LIMIT) {
            return res.status(429).send({ error: "Aapki aaj ki free limit (20 messages) poori ho gayi hai." });
        }

        // Gemini API ko call karein
        const { contents, systemInstruction } = req.body;
        if (!contents) return res.status(400).json({ error: 'Request body must contain "contents".' });
        
        const currentApiKey = getNextApiKey();
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${currentApiKey}`;
        const payload = { contents, ...(systemInstruction && { systemInstruction }) };
        
        const response = await axios.post(apiUrl, payload);
        const textResponse = response.data.candidates[0].content.parts[0].text;
        
        // UNCOMMENT KIYA GAYA: Success ke baad, count update karein
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

// UPDATED: Image Generation Endpoint with the SAME Limit
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

        // Limit check ab yahan bhi kaam karega
        if (doc.exists && doc.data().date === today && doc.data().count >= DAILY_LIMIT) {
            return res.status(429).send({ error: "Aapki aaj ki free limit (20 messages/images) poori ho gayi hai." });
        }

        // Image generation logic
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Request body must contain "prompt".' });

        const imageApiKey = getNextApiKey(); // You might use a different key for images if needed
        const imageUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${imageApiKey}`; // Replace with actual image generation model if different
        // NOTE: This is a placeholder for actual image generation API call structure.
        // Assuming Gemini text-to-image API. Adjust payload as per official documentation.
        // The actual image generation logic might be different. I am keeping your core logic.
        const response = await axios.post(imageUrl, { contents: [{ parts: [{ text: `Generate an image of: ${prompt}` }] }] });
        const generatedImageContent = response.data.candidates[0].content.parts[0].text; // Placeholder, adjust based on actual API response for images

        // Count update yahan bhi karein
        const currentCount = (doc.exists && doc.data().date === today) ? doc.data().count : 0;
        await usageDocRef.set({
            date: today,
            count: currentCount + 1
        }, { merge: true });

        // Send back a placeholder or the actual image data
        res.json({ base64Image: generatedImageContent }); // Assuming you get base64 image data

    } catch (error) {
        console.error('Error in /api/generate-image:', error.message);
        res.status(500).json({ error: 'Failed to generate image.' });
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
