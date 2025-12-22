const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

// --- NAYA: Firebase Admin SDK Setup ---
const admin = require('firebase-admin');
// ZAROORI: Apne Firebase project se 'serviceAccountKey.json' file download karke
// is file ke saath rakhein.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const DAILY_LIMIT = 20; // Aap apni free limit yahan set kar sakte hain
// ------------------------------------

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Limit 50mb kar di taaki photo/pdf send ho sake
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

// === SAHI WALA /api/generate ENDPOINT (SIRF EK BAAR) ===
app.post('/api/generate', async (req, res) => {
    // Abhi ke liye hum limit check ko band rakhenge, aap baad mein chalu kar sakte hain
    /*
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
        return res.status(401).send({ error: "Authentication token nahi mila." });
    }
    */
    
    try {
        /*
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        // Firestore limit check logic yahan aayegi...
        */

        const { contents, systemInstruction } = req.body;
        if (!contents) {
            return res.status(400).json({ error: 'Request body must contain "contents".' });
        }
        
        const currentApiKey = getNextApiKey();
        // Naya (Jo high limit wala hai):
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${currentApiKey}`;

        const payload = { contents, ...(systemInstruction && { systemInstruction }) };
        
        const response = await axios.post(apiUrl, payload);
        const textResponse = response.data.candidates[0].content.parts[0].text;
        
        // Firestore limit update logic yahan aayegi...
        
        res.json({ text: textResponse });

    } catch (error) {
        console.error('Error in /api/generate:', error.response ? error.response.data : error.message);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).send({ error: "Session expire ho gaya, कृपया dobara login karein." });
        }
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

        // 1. Pollinations AI ka URL banayein (Seed add karte hain taki har baar alag image bane)
        const seed = Math.floor(Math.random() * 10000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=512&height=512&nologo=true`;

        // 2. Image ko download karein (Binary format mein)
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

        // 3. Image ko Base64 mein convert karein (Kyuki apka frontend Base64 mangta hai)
        const base64Image = Buffer.from(response.data, 'binary').toString('base64');

       // 4. Frontend ko bhej dein (URL zaroor bhejein history ke liye)
    res.json({ 
    base64Image: base64Image,
    imageUrl: imageUrl 
});

    } catch (error) {
        console.error("Image Gen Error:", error.message);
        // Agar fail ho jaye, to user ko error dikhayein
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





