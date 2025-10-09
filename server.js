const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin'); // <-- NAYA: Firebase Admin

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- NAYA: Firebase Admin SDK Setup --
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

console.log("Server is using Firebase project:", serviceAccount.project_id);

const db = admin.firestore();
const DAILY_LIMIT = 20; // Har user ke liye daily 20 message ki limit

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
// Apne server.js mein purane '/api/generate' function ko is poore naye function se badal dein

app.post('/api/generate', async (req, res) => {
    console.log("--- New Request Received ---");
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        console.log("Error: Frontend se token nahi mila.");
        return res.status(401).send({ error: "Authentication token nahi mila." });
    }

    console.log("Token mila. Ab verify karne ki koshish kar rahe hain...");

    try {
        // Step 2: Token ko verify karein
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        console.log("Token verification SAFAL. UID:", decodedToken.uid);

        // Token verify hone ke baad hi aage ka code chalega
        const uid = decodedToken.uid;
        const today = new Date().toISOString().split('T')[0];
        const usageDocRef = db.collection('usageLimits').doc(uid);
        const doc = await usageDocRef.get();

        if (doc.exists && doc.data().date === today && doc.data().count >= DAILY_LIMIT) {
            console.log(`User ${uid} has reached their daily limit.`);
            return res.status(429).send({ error: "Aapki aaj ki free limit poori ho gayi hai." });
        }

        console.log("User limit theek hai. Ab Gemini API ko call kar rahe hain...");
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

        // Server crash se bachne ke liye check
        if (!response.data.candidates || response.data.candidates.length === 0) {
            console.error("Gemini API returned no candidates. Response might be blocked by safety filters.");
            return res.status(500).json({ error: "AI model ne response generate nahi kiya. Ho sakta hai content safety ki vajah se block ho gaya ho." });
        }
        const textResponse = response.data.candidates[0].content.parts[0].text;
        
        console.log("Gemini se response mil gaya. Ab Firestore update kar rahe hain...");
        const currentCount = (doc.exists && doc.data().date === today) ? doc.data().count : 0;
        await usageDocRef.set({
            date: today,
            count: currentCount + 1
        }, { merge: true });
        
        res.json({ text: textResponse });

    } catch (error) {
        // YEH SABSE ZAROORI HISSA HAI
        console.error("!!! TOKEN VERIFICATION FAIL HUA YA KOI AUR ERROR AAYA !!!");
        console.error("Error Code:", error.code);
        console.error("Error Message:", error.message);
        console.error("Full Error Object:", JSON.stringify(error, null, 2));

        // Frontend ko saaf error bhejein
        return res.status(401).send({ 
            error: "Token verification fail ho gaya.", 
            details: `Error code: ${error.code}`
        });
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

