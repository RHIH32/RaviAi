const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const cors = require('cors'); // ZAROORI: CORS ko enable karne ke liye
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // ZAROORI: CORS middleware ka istemaal karein
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- API Key Configuration ---
// UPDATED: Read multiple keys and prepare for rotation
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [];
let currentKeyIndex = 0;

// Function to get the next key in a round-robin fashion
function getNextApiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error("No Gemini API keys found in .env file.");
    }
    const key = GEMINI_API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length; // Move to the next key index
    return key;
}

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_PLAN_ID = process.env.RAZORPAY_PLAN_ID;

// --- Critical Validation ---
// UPDATED: Check for GEMINI_API_KEYS
if (GEMINI_API_KEYS.length === 0 || !RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_PLAN_ID) {
    console.error("FATAL ERROR: One or more environment variables (GEMINI_API_KEYS, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_PLAN_ID) are not set correctly in .env file.");
    process.exit(1);
}

// --- Razorpay Instance ---
const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

// === AI API Endpoints ===
app.post('/api/generate', async (req, res) => {
    const { contents, systemInstruction } = req.body;
    if (!contents) return res.status(400).json({ error: 'Request body must contain "contents".' });
    
    // UPDATED: Get a rotating API key for each request
    const currentApiKey = getNextApiKey();
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${currentApiKey}`;
    
    const payload = { contents, ...(systemInstruction && { systemInstruction }) };
    try {
        const response = await axios.post(apiUrl, payload);
        const textResponse = response.data.candidates[0].content.parts[0].text;
        res.json({ text: textResponse });
    } catch (error) {
        console.error('Error calling Gemini API:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to get response from AI model.' });
    }
});

app.post('/api/generate-image', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Request body must contain "prompt".' });

    // UPDATED: Get a rotating API key for each request
    const currentApiKey = getNextApiKey();
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${currentApiKey}`;
    
    const payload = { instances: [{ prompt }], parameters: { "sampleCount": 1 } };
    try {
        const response = await axios.post(apiUrl, payload);
        if (response.data.predictions?.[0]?.bytesBase64Encoded) {
            res.json({ base64Image: response.data.predictions[0].bytesBase64Encoded });
        } else {
            throw new Error("Invalid response structure from image generation API.");
        }
    } catch (error) {
        console.error('Error calling Image Generation API:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to generate image.' });
    }
});

// === Payment API Endpoints ===
app.post('/api/create-subscription', async (req, res) => {
    try {
        const subscription = await razorpay.subscriptions.create({
            plan_id: RAZORPAY_PLAN_ID,
            customer_notify: 1,
            quantity: 1,
            total_count: 1, // The subscription will run for 1 month
        });

        res.json({
            subscriptionId: subscription.id,
            keyId: RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error("Error creating Razorpay subscription:", error);
        res.status(500).send("Error creating subscription.");
    }
});

app.post('/api/verify-payment', (req, res) => {
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature } = req.body;
    const body = razorpay_payment_id + "|" + razorpay_subscription_id;
    
    try {
        const expectedSignature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature === razorpay_signature) {
            res.json({ status: 'success' });
        } else {
            res.status(400).json({ status: 'failure', message: 'Signature validation failed.' });
        }
    } catch (error) {
        console.error("Error during payment verification:", error);
        res.status(500).json({ status: 'failure', message: "Internal server error during verification." });
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

