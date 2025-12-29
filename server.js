const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Parser = require('rss-parser'); // RSS News ke liye
require('dotenv').config();

// --- Firebase Admin Setup ---
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
const parser = new Parser(); 
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// --- API Keys ---
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [];
let currentKeyIndex = 0;

function getNextApiKey() {
    if (GEMINI_API_KEYS.length === 0) throw new Error("No API keys found.");
    const key = GEMINI_API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
    return key;
}

// 🛠️ HELPER: System Time
function getSystemTime() {
    const now = new Date();
    return now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
}

// 🛠️ HELPER: Google News RSS (Text Only - No Links)
async function getGoogleNews() {
    try {
        const feed = await parser.parseURL("https://news.google.com/rss?ceid=IN:en&hl=en-IN&gl=IN");
        return feed.items.slice(0, 5).map(item => `- ${item.title}`).join("\n");
    } catch (e) { return null; }
}

// === MAIN API ===
app.post('/api/generate', async (req, res) => {
    try {
        const { contents, systemInstruction } = req.body;
        if (!contents) return res.status(400).json({ error: 'No contents' });

        const lastMessage = contents[contents.length - 1]?.parts[0]?.text?.toLowerCase() || "";
        const currentApiKey = getNextApiKey();
        let finalSystemInstruction = systemInstruction?.parts[0]?.text || "";
        
        let tools = []; // Default: No Tools (No Google Search Button)
        let extraContext = "";

        // --- 1. 🕒 TIME & DATE (Server Text) ---
        if (lastMessage.includes("time") || lastMessage.includes("samay") || lastMessage.includes("date") || lastMessage.includes("tarikh")) {
            console.log("🕒 Time Injection");
            extraContext += `\n[SYSTEM UPDATE]: Current Date/Time in India is: ${getSystemTime()}. User ko ye time batao.`;
        }

        // --- 2. 📰 NEWS (RSS Text - 100% Safe from Links) ---
        else if (lastMessage.includes("news") || lastMessage.includes("khabar") || lastMessage.includes("samachar")) {
            console.log("📰 RSS News Injection");
            const newsData = await getGoogleNews();
            if (newsData) {
                // Hum AI ko NEWS text de rahe hain, Link nahi.
                // AI isse padhega jaise ye uski memory ho.
                extraContext += `\n[LATEST NEWS SUMMARY]:\n${newsData}\n(In khabron ko padhkar user ko Hinglish mein sunao. Koi link mat dena).`;
            }
        }

        // --- 3. 🏏 CRICKET/WEATHER (Google Search - Hidden) ---
        // Agar user Cricket/Weather puche, tabhi Google Search Tool ON karenge.
        // Lekin Frontend ka prompt (Index.html) link ko rok dega.
        else if (lastMessage.includes("weather") || lastMessage.includes("mausam") || lastMessage.includes("score") || lastMessage.includes("match")) {
            console.log("⚠️ Using Google Search for Live Data");
            tools = [{ googleSearch: {} }];
        }

        // --- 4. 🖼️ IMAGE GENERATION (Fake Response) ---
        if (lastMessage.includes("draw") || lastMessage.includes("create") || lastMessage.includes("banao")) {
             const fakeResponse = JSON.stringify({
                action: "generate_image",
                prompt: lastMessage,
                response: "Bilkul! Tasveer bana raha hoon... 🎨"
            });
            return res.json({ text: fakeResponse });
        }

        // --- FINAL PROMPT ASSEMBLY ---
        if (extraContext) {
            finalSystemInstruction += extraContext;
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentApiKey}`;           
        const payload = { 
            contents, 
            systemInstruction: { parts: [{ text: finalSystemInstruction }] },
            ...(tools.length > 0 && { tools: tools }) 
        };
        
        const response = await axios.post(apiUrl, payload);
        const candidate = response.data.candidates[0];
        let textResponse = candidate.content?.parts?.map(p => p.text || "").join("") || "";

        res.json({ text: textResponse });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'AI Error' });
    }
});

// Image API (Stable)
app.post('/api/generate-image', async (req, res) => {
    try {
        const { prompt } = req.body;
        const seed = Math.floor(Math.random() * 10000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1024&height=1024&nologo=true&model=flux`; // Model flux kar diya better quality ke liye
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
        const base64Image = Buffer.from(response.data, 'binary').toString('base64');
        res.json({ base64Image, imageUrl });
    } catch (error) {
        res.status(500).json({ error: "Image Failed" });
    }
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
