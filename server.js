const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();


const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- NAYA: Firebase Admin SDK Setup ---
// ==========================================================
// PURAANE /api/generate FUNCTION KI JAGAH YEH PASTE KAREIN
// ==========================================================

app.post('/api/generate', async (req, res) => {
    // Ab yahan koi token check nahi hai
    try {
        const { contents, systemInstruction } = req.body;
        if (!contents) {
            return res.status(400).json({ error: 'Request body must contain "contents".' });
        }
        
        const currentApiKey = getNextApiKey();
        const payload = { contents, ...(systemInstruction && { systemInstruction }) };
        // Nayi Sahi Line ✅
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${currentApiKey}`;
        const response = await axios.post(apiUrl, payload);
        const textResponse = response.data.candidates[0].content.parts[0].text;
        
        res.json({ text: textResponse });

    } catch (error) {
        console.error('Error in /api/generate:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to get response from AI model.' });
    }
});
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

// Critical Validation (Razorpay keys hata di gayi hain)
if (GEMINI_API_KEYS.length === 0) {
    console.error("FATAL ERROR: GEMINI_API_KEYS environment variable is not set correctly.");
    process.exit(1);
}


// === AI API Endpoints ===

// UPDATED: /api/generate with Limit Check
app.post('/api/generate', async (req, res) => {
    // Step 1: Frontend se bheja gaya token nikalein
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
        return res.status(401).send({ error: "Authentication token nahi mila." });
    }

    try {
        // Step 2: Token ko verify karke user ka UID nikalein
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        // Step 3: Firestore se user ka usage data nikalein
        const today = new Date().toISOString().split('T')[0]; // Aaj ki date (e.g., "2025-09-30")
        const usageDocRef = db.collection('usageLimits').doc(uid);
       
        // ...
      const doc = await usageDocRef.get();

      /* LIMIT CHECK KO COMMENT KAR DIYA GAYA HAI
      if (doc.exists && doc.data().date === today && doc.data().count >= DAILY_LIMIT) {
          // Step 4: Agar limit poori ho gayi hai, to error bhejein
          return res.status(429).send({ error: "Aapki aaj ki free limit poori ho gayi hai." });
      }
      */
// ...
        // Step 5: Agar limit baaki hai, to Gemini API ko call karein
        const { contents, systemInstruction } = req.body;
        if (!contents) return res.status(400).json({ error: 'Request body must contain "contents".' });
        
        const currentApiKey = getNextApiKey();
       // Nayi Sahi Line ✅
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${currentApiKey}`;
        const payload = { contents, ...(systemInstruction && { systemInstruction }) };
        
        const response = await axios.post(apiUrl, payload);
        // ...
      const textResponse = response.data.candidates[0].content.parts[0].text;
      
      /* LIMIT UPDATE KO COMMENT KAR DIYA GAYA HAI
      // Step 6: Success ke baad, Firestore mein count update karein
      const currentCount = (doc.exists && doc.data().date === today) ? doc.data().count : 0;
      await usageDocRef.set({
          date: today,
          count: currentCount + 1
      }, { merge: true }); // 'merge: true' zaroori hai taaki puraana data delete na ho
      */
      
      res.json({ text: textResponse });
// ...

    } catch (error) {
        console.error('Error in /api/generate:', error.response ? error.response.data : error.message);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).send({ error: "Session expire ho gaya, कृपया dobara login karein." });
        }
        res.status(500).json({ error: 'Failed to get response from AI model.' });
    }
});


// Image Generation Endpoint (Ismein abhi limit nahi lagayi hai, aap laga sakte hain)
app.post('/api/generate-image', async (req, res) => {
    // ... (generate-image ka code waisa hi rahega) ...
    // NOTE: Aap upar waali limit logic ismein bhi add kar sakte hain
});


// === Payment API Endpoints (DELETE KAR DIYE GAYE) ===
// (Yahan ab kuchh nahi hai)


// === Static File Serving ===
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Ravi AI server is running at http://localhost:${port}`);
});







